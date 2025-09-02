// distribution-manager.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface DistributionRecord {
  amount: number;
  timestamp: number;
  redeemed: boolean;
}

interface EnrollmentData {
  enrollmentDate: number;
  region: string;
  school: string;
}

interface RegionalCap {
  cap: number;
  used: number;
}

interface DistributionLog {
  student: string;
  amount: number;
  round: number;
  block: number;
}

interface ContractState {
  admin: string;
  paused: boolean;
  currentRound: number;
  tokensPerStudent: number;
  lastDistributionBlock: number;
  studentDistributions: Map<string, DistributionRecord>; // key: `${student}-${round}`
  regionalCaps: Map<string, RegionalCap>;
  allowedRegions: Set<string>;
  distributionLogs: Map<number, DistributionLog>;
  logCounter: number;
  // Mocked dependencies
  tokenBalances: Map<string, number>; // For token contract simulation
  verifiedStudents: Set<string>;
  enrollmentData: Map<string, EnrollmentData>;
  regionalEligibility: Map<string, boolean>;
}

interface TraitMocks {
  accessToken: {
    transfer: (amount: number, from: string, to: string) => ClarityResponse<boolean>;
    // Add more if needed
  };
  oracle: {
    getRegionalEligibility: (region: string) => ClarityResponse<boolean>;
  };
  verifier: {
    isVerified: (student: string) => ClarityResponse<boolean>;
    getEnrollmentData: (student: string) => ClarityResponse<EnrollmentData>;
  };
}

// Mock contract implementation
class DistributionManagerMock {
  private state: ContractState = {
    admin: "deployer",
    paused: false,
    currentRound: 1,
    tokensPerStudent: 500,
    lastDistributionBlock: 0,
    studentDistributions: new Map(),
    regionalCaps: new Map(),
    allowedRegions: new Set(),
    distributionLogs: new Map(),
    logCounter: 0,
    tokenBalances: new Map([["deployer", 1000000]]), // Initial pool
    verifiedStudents: new Set(),
    enrollmentData: new Map(),
    regionalEligibility: new Map(),
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_NOT_VERIFIED = 102;
  private ERR_REGION_INELIGIBLE = 103;
  private ERR_DISTRIBUTION_PAUSED = 104;
  private ERR_ALREADY_DISTRIBUTED = 105;
  private ERR_CAP_EXCEEDED = 107;
  private ERR_INVALID_PARAM = 108;
  private MAX_TOKENS_PER_STUDENT = 1000;
  private DISTRIBUTION_ROUND_INTERVAL = 144;
  private currentBlock = 100; // Mock block height

  // Helper to simulate block height
  private getBlockHeight() {
    return this.currentBlock;
  }

  private advanceBlock() {
    this.currentBlock += 1;
  }

  private getTraitMocks(caller: string): TraitMocks {
    return {
      accessToken: {
        transfer: (amount: number, from: string, to: string) => {
          if (from !== caller) return { ok: false, value: this.ERR_UNAUTHORIZED };
          const fromBal = this.state.tokenBalances.get(from) ?? 0;
          if (fromBal < amount) return { ok: false, value: this.ERR_INVALID_AMOUNT };
          const toBal = this.state.tokenBalances.get(to) ?? 0;
          this.state.tokenBalances.set(from, fromBal - amount);
          this.state.tokenBalances.set(to, toBal + amount);
          return { ok: true, value: true };
        },
      },
      oracle: {
        getRegionalEligibility: (region: string) => {
          return { ok: true, value: this.state.regionalEligibility.get(region) ?? false };
        },
      },
      verifier: {
        isVerified: (student: string) => {
          return { ok: true, value: this.state.verifiedStudents.has(student) };
        },
        getEnrollmentData: (student: string) => {
          const data = this.state.enrollmentData.get(student);
          return data ? { ok: true, value: data } : { ok: false, value: this.ERR_NOT_VERIFIED };
        },
      },
    };
  }

  distributeTokens(
    caller: string,
    student: string,
    amount: number
  ): ClarityResponse<boolean> {
    if (!this.state.allowedRegions.has("test-region")) {
      this.state.allowedRegions.add("test-region"); // Default for tests
    }
    const mocks = this.getTraitMocks(caller);
    const round = this.state.currentRound;
    const key = `${student}-${round}`;
    if (this.state.paused) {
      return { ok: false, value: this.ERR_DISTRIBUTION_PAUSED };
    }
    if (this.state.studentDistributions.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_DISTRIBUTED };
    }
    if (amount > this.MAX_TOKENS_PER_STUDENT) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    // Simulate eligibility check
    const verified = mocks.verifier.isVerified(student);
    if (!verified.ok || !verified.value) {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    const enrollment = mocks.verifier.getEnrollmentData(student);
    if (!enrollment.ok) {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    const region = enrollment.value.region;
    const regionalEligible = mocks.oracle.getRegionalEligibility(region);
    if (!regionalEligible.ok || !regionalEligible.value) {
      return { ok: false, value: this.ERR_REGION_INELIGIBLE };
    }
    if (!this.state.allowedRegions.has(region)) {
      return { ok: false, value: this.ERR_REGION_INELIGIBLE };
    }
    // Enforce caps
    const capInfo = this.state.regionalCaps.get(region) ?? { cap: 0, used: 0 };
    if (capInfo.cap > 0 && capInfo.used + amount > capInfo.cap) {
      return { ok: false, value: this.ERR_CAP_EXCEEDED };
    }
    this.state.regionalCaps.set(region, { cap: capInfo.cap, used: capInfo.used + amount });
    // Transfer
    const transferRes = mocks.accessToken.transfer(amount, caller, student);
    if (!transferRes.ok) {
      return transferRes;
    }
    // Set distribution
    this.state.studentDistributions.set(key, {
      amount,
      timestamp: this.getBlockHeight(),
      redeemed: false,
    });
    // Log
    const logId = ++this.state.logCounter;
    this.state.distributionLogs.set(logId, {
      student,
      amount,
      round,
      block: this.getBlockHeight(),
    });
    return { ok: true, value: true };
  }

  startNewRound(caller: string): ClarityResponse<number> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.getBlockHeight() - this.state.lastDistributionBlock <= this.DISTRIBUTION_ROUND_INTERVAL) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    this.state.currentRound += 1;
    this.state.lastDistributionBlock = this.getBlockHeight();
    // Reset used caps
    for (const [region, cap] of this.state.regionalCaps) {
      this.state.regionalCaps.set(region, { ...cap, used: 0 });
    }
    return { ok: true, value: this.state.currentRound };
  }

  setTokensPerStudent(caller: string, newAmount: number): ClarityResponse<number> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newAmount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.tokensPerStudent = newAmount;
    return { ok: true, value: newAmount };
  }

  addAllowedRegion(caller: string, region: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.allowedRegions.add(region);
    return { ok: true, value: true };
  }

  removeAllowedRegion(caller: string, region: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.allowedRegions.delete(region);
    return { ok: true, value: true };
  }

  setRegionalCap(caller: string, region: string, cap: number): ClarityResponse<number> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.regionalCaps.set(region, { cap, used: 0 });
    return { ok: true, value: cap };
  }

  pauseDistribution(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseDistribution(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  getStudentDistribution(student: string, round: number): ClarityResponse<DistributionRecord | null> {
    const key = `${student}-${round}`;
    return { ok: true, value: this.state.studentDistributions.get(key) ?? null };
  }

  getRegionalCap(region: string): ClarityResponse<RegionalCap | null> {
    return { ok: true, value: this.state.regionalCaps.get(region) ?? null };
  }

  isRegionAllowed(region: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.allowedRegions.has(region) };
  }

  getCurrentRound(): ClarityResponse<number> {
    return { ok: true, value: this.state.currentRound };
  }

  getTokensPerStudent(): ClarityResponse<number> {
    return { ok: true, value: this.state.tokensPerStudent };
  }

  getDistributionLog(logId: number): ClarityResponse<DistributionLog | null> {
    return { ok: true, value: this.state.distributionLogs.get(logId) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  // For testing: setup helpers
  setupStudent(student: string, region: string, verified: boolean = true) {
    if (verified) this.state.verifiedStudents.add(student);
    this.state.enrollmentData.set(student, {
      enrollmentDate: Date.now(),
      region,
      school: "Test School",
    });
    this.state.regionalEligibility.set(region, true);
  }

  advanceBlocks(blocks: number) {
    this.currentBlock += blocks;
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  student1: "student_1",
  student2: "student_2",
  unauthorized: "unauth",
};

describe("DistributionManager Contract", () => {
  let contract: DistributionManagerMock;

  beforeEach(() => {
    contract = new DistributionManagerMock();
    vi.resetAllMocks();
    // Default setup
    contract.setupStudent(accounts.student1, "region_a");
    contract.setupStudent(accounts.student2, "region_b");
    contract.addAllowedRegion(accounts.deployer, "region_a");
    contract.addAllowedRegion(accounts.deployer, "region_b");
  });

  it("should allow admin to set tokens per student", () => {
    const result = contract.setTokensPerStudent(accounts.deployer, 600);
    expect(result).toEqual({ ok: true, value: 600 });
    expect(contract.getTokensPerStudent()).toEqual({ ok: true, value: 600 });
  });

  it("should prevent non-admin from setting tokens per student", () => {
    const result = contract.setTokensPerStudent(accounts.unauthorized, 600);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should distribute tokens to eligible student", () => {
    const result = contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    expect(result).toEqual({ ok: true, value: true });
    const dist = contract.getStudentDistribution(accounts.student1, 1);
    expect(dist).toEqual({
      ok: true,
      value: expect.objectContaining({ amount: 500 }),
    });
    const log = contract.getDistributionLog(1);
    expect(log).toEqual({
      ok: true,
      value: expect.objectContaining({ student: accounts.student1, amount: 500 }),
    });
  });

  it("should prevent distribution to unverified student", () => {
    contract.setupStudent("unverified", "region_a", false);
    const result = contract.distributeTokens(accounts.deployer, "unverified", 500);
    expect(result).toEqual({ ok: false, value: 102 });
  });

  it("should enforce max tokens per student", () => {
    const result = contract.distributeTokens(accounts.deployer, accounts.student1, 1500);
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should prevent duplicate distribution in same round", () => {
    contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    const result = contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    expect(result).toEqual({ ok: false, value: 105 });
  });

  it("should enforce regional caps", () => {
    contract.setRegionalCap(accounts.deployer, "region_a", 600);
    contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    const result = contract.distributeTokens(accounts.deployer, accounts.student1, 200); // Different student? Wait, same round but different student
    contract.setupStudent("student3", "region_a");
    const result2 = contract.distributeTokens(accounts.deployer, "student3", 200);
    expect(result2).toEqual({ ok: false, value: 107 });
  });

  it("should allow starting new round after interval", () => {
    contract.advanceBlocks(145);
    const result = contract.startNewRound(accounts.deployer);
    expect(result).toEqual({ ok: true, value: 2 });
    expect(contract.getCurrentRound()).toEqual({ ok: true, value: 2 });
  });

  it("should prevent starting new round too soon", () => {
    const result = contract.startNewRound(accounts.deployer);
    expect(result).toEqual({ ok: false, value: 108 });
  });

  it("should pause and unpause distributions", () => {
    const pause = contract.pauseDistribution(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const distDuringPause = contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    expect(distDuringPause).toEqual({ ok: false, value: 104 });

    const unpause = contract.unpauseDistribution(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should add and remove allowed regions", () => {
    const add = contract.addAllowedRegion(accounts.deployer, "new_region");
    expect(add).toEqual({ ok: true, value: true });
    expect(contract.isRegionAllowed("new_region")).toEqual({ ok: true, value: true });

    const remove = contract.removeAllowedRegion(accounts.deployer, "new_region");
    expect(remove).toEqual({ ok: true, value: true });
    expect(contract.isRegionAllowed("new_region")).toEqual({ ok: true, value: false });
  });

  it("should prevent distribution to disallowed region", () => {
    contract.removeAllowedRegion(accounts.deployer, "region_a");
    const result = contract.distributeTokens(accounts.deployer, accounts.student1, 500);
    expect(result).toEqual({ ok: false, value: 103 });
  });
});