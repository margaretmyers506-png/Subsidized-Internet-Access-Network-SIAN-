;; DistributionManager.clar
;; Core contract for managing subsidized internet access token distributions
;; Integrates with EnrollmentVerifier for student verification,
;; AccessToken for token minting/transfer, and OracleIntegrator for external data.
;; Handles automated distributions, eligibility checks, caps, and governance.

;; Traits for dependencies
(define-trait access-token-trait
  (
    (mint (uint principal) (response bool uint))
    (transfer (uint principal principal) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

(define-trait enrollment-verifier-trait
  (
    (is-verified (principal) (response bool uint))
    (get-enrollment-data (principal) (response {enrollment-date: uint, region: (string-ascii 32), school: (string-ascii 64)} uint))
  )
)

(define-trait oracle-integrator-trait
  (
    (get-regional-eligibility ((string-ascii 32)) (response bool uint))
    (get-enrollment-proof (principal) (response (buff 32) uint))
  )
)

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-NOT-VERIFIED u102)
(define-constant ERR-REGION-INELIGIBLE u103)
(define-constant ERR-DISTRIBUTION-PAUSED u104)
(define-constant ERR-ALREADY-DISTRIBUTED u105)
(define-constant ERR-INVALID-RECIPIENT u106)
(define-constant ERR-CAP-EXCEEDED u107)
(define-constant ERR-INVALID-PARAM u108)
(define-constant ERR-ORACLE-FAIL u109)
(define-constant MAX-TOKENS-PER-STUDENT u1000) ;; Example cap: 1000 tokens per student per round
(define-constant DISTRIBUTION-ROUND-INTERVAL u144) ;; ~1 day in blocks

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var current-round uint u1)
(define-data-var tokens-per-student uint u500) ;; Configurable subsidy amount
(define-data-var last-distribution-block uint block-height)

;; Data Maps
(define-map student-distributions
  { student: principal, round: uint }
  { amount: uint, timestamp: uint, redeemed: bool }
)

(define-map regional-caps
  (string-ascii 32) ;; region code
  { cap: uint, used: uint }
)

(define-map allowed-regions
  (string-ascii 32)
  bool
)

(define-map distribution-logs
  uint ;; log-id
  { student: principal, amount: uint, round: uint, block: uint }
)

(define-data-var log-counter uint u0)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get contract-admin))
)

(define-private (increment-log-counter)
  (let ((current (var-get log-counter)))
    (var-set log-counter (+ current u1))
    current
  )
)

(define-private (log-distribution (student principal) (amount uint) (round uint))
  (let ((log-id (increment-log-counter)))
    (map-set distribution-logs log-id
      { student: student, amount: amount, round: round, block: block-height }
    )
    (print { event: "distribution", student: student, amount: amount, round: round })
  )
)

(define-private (check-eligibility-internal (student principal) (oracle <oracle-integrator-trait>) (verifier <enrollment-verifier-trait>))
  (let
    (
      (verified (try! (contract-call? verifier is-verified student)))
      (enrollment (try! (contract-call? verifier get-enrollment-data student)))
      (region (get region enrollment))
      (regional-eligible (try! (contract-call? oracle get-regional-eligibility region)))
    )
    (if (and verified regional-eligible (is-some (map-get? allowed-regions region)))
      (ok true)
      (err ERR-NOT-VERIFIED)
    )
  )
)

(define-private (enforce-caps (region (string-ascii 32)) (amount uint))
  (match (map-get? regional-caps region)
    cap-info
    (let ((used (get used cap-info)) (cap (get cap cap-info)))
      (if (>= (+ used amount) cap)
        (err ERR-CAP-EXCEEDED)
        (begin
          (map-set regional-caps region { cap: cap, used: (+ used amount) })
          (ok true)
        )
      )
    )
    (ok true) ;; No cap set, allow
  )
)

;; Public Functions
(define-public (distribute-tokens
  (student principal)
  (amount uint)
  (token-contract <access-token-trait>)
  (oracle <oracle-integrator-trait>)
  (verifier <enrollment-verifier-trait>)
)
  (let
    (
      (round (var-get current-round))
      (existing (map-get? student-distributions { student: student, round: round }))
      (enrollment (try! (contract-call? verifier get-enrollment-data student)))
      (region (get region enrollment))
    )
    (if (var-get paused)
      (err ERR-DISTRIBUTION-PAUSED)
      (if (is-some existing)
        (err ERR-ALREADY-DISTRIBUTED)
        (if (> amount MAX-TOKENS-PER-STUDENT)
          (err ERR-INVALID-AMOUNT)
          (begin
            (try! (check-eligibility-internal student oracle verifier))
            (try! (enforce-caps region amount))
            (try! (contract-call? token-contract transfer amount tx-sender student))
            (map-set student-distributions { student: student, round: round }
              { amount: amount, timestamp: block-height, redeemed: false }
            )
            (log-distribution student amount round)
            (ok true)
          )
        )
      )
    )
  )
)

(define-public (auto-distribute
  (students (list 100 principal))
  (token-contract <access-token-trait>)
  (oracle <oracle-integrator-trait>)
  (verifier <enrollment-verifier-trait>)
)
  (if (var-get paused)
    (err ERR-DISTRIBUTION-PAUSED)
    (fold distribute-iter students (ok u0) token-contract oracle verifier)
  )
)

(define-private (distribute-iter
  (student principal)
  (prev (response uint uint))
  (token-contract <access-token-trait>)
  (oracle <oracle-integrator-trait>)
  (verifier <enrollment-verifier-trait>)
)
  (match prev
    count
    (match (distribute-tokens student (var-get tokens-per-student) token-contract oracle verifier)
      success (+ count u1)
      error count ;; Skip errors, continue
    )
    error prev
  )
)

(define-public (start-new-round)
  (if (is-admin tx-sender)
    (if (> (- block-height (var-get last-distribution-block)) DISTRIBUTION-ROUND-INTERVAL)
      (begin
        (var-set current-round (+ (var-get current-round) u1))
        (var-set last-distribution-block block-height)
        ;; Reset used caps for regions if needed
        (ok (var-get current-round))
      )
      (err ERR-INVALID-PARAM)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-tokens-per-student (new-amount uint))
  (if (is-admin tx-sender)
    (if (> new-amount u0)
      (begin
        (var-set tokens-per-student new-amount)
        (ok new-amount)
      )
      (err ERR-INVALID-AMOUNT)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (add-allowed-region (region (string-ascii 32)))
  (if (is-admin tx-sender)
    (begin
      (map-set allowed-regions region true)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (remove-allowed-region (region (string-ascii 32)))
  (if (is-admin tx-sender)
    (begin
      (map-delete allowed-regions region)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-regional-cap (region (string-ascii 32)) (cap uint))
  (if (is-admin tx-sender)
    (begin
      (map-set regional-caps region { cap: cap, used: u0 })
      (ok cap)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (pause-distribution)
  (if (is-admin tx-sender)
    (begin
      (var-set paused true)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-distribution)
  (if (is-admin tx-sender)
    (begin
      (var-set paused false)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (transfer-admin (new-admin principal))
  (if (is-admin tx-sender)
    (begin
      (var-set contract-admin new-admin)
      (ok new-admin)
    )
    (err ERR-UNAUTHORIZED)
  )
)

;; Read-only Functions
(define-read-only (get-student-distribution (student principal) (round uint))
  (map-get? student-distributions { student: student, round: round })
)

(define-read-only (get-regional-cap (region (string-ascii 32)))
  (map-get? regional-caps region)
)

(define-read-only (is-region-allowed (region (string-ascii 32)))
  (default-to false (map-get? allowed-regions region))
)

(define-read-only (get-current-round)
  (var-get current-round)
)

(define-read-only (get-tokens-per-student)
  (var-get tokens-per-student)
)

(define-read-only (get-distribution-log (log-id uint))
  (map-get? distribution-logs log-id)
)

(define-read-only (get-contract-admin)
  (var-get contract-admin)
)

(define-read-only (is-paused)
  (var-get paused)
)