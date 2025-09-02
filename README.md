# 🌐 Subsidized Internet Access Network (SIAN)

Welcome to the Subsidized Internet Access Network, a blockchain-powered solution built on the Stacks blockchain using Clarity smart contracts! This project addresses the real-world problem of limited and unaffordable internet access for students in developing regions. By distributing subsidized access tokens based on verified enrollment, it enables transparent, tamper-proof allocation of resources for educational purposes. Donors fund the system, schools verify enrollment, and ISPs redeem tokens for actual internet service— all decentralized and auditable.

## ✨ Features

🌍 Transparent token distribution to verified students in developing regions  
💰 Donor-funded subsidies converted into fungible access tokens  
📚 Enrollment verification integrated with secure oracles  
🔄 Redeemable tokens for internet data packages with partnered ISPs  
📊 Usage tracking and reporting for accountability  
🛡️ Governance for managing funds and updating parameters  
🔒 Immutable records to prevent fraud and ensure fair access

## 📜 Smart Contracts

This project leverages 8 Clarity smart contracts to create a robust, decentralized ecosystem:

1. **EnrollmentVerifier.clar**: Handles verification of student enrollment using oracle inputs or admin approvals from educational institutions.  
2. **AccessToken.clar**: Implements a SIP-010 compliant fungible token for subsidized internet access credits.  
3. **DistributionManager.clar**: Manages the automated distribution of tokens to verified students based on enrollment data.  
4. **FundingPool.clar**: Collects and pools donations in STX or other assets, converting them into access tokens.  
5. **RedemptionGateway.clar**: Allows ISPs to redeem tokens for payouts, tracking actual internet usage.  
6. **UsageTracker.clar**: Logs token redemptions and generates reports on access utilization for donors and auditors.  
7. **OracleIntegrator.clar**: Interfaces with external oracles for real-time data like enrollment proofs or regional eligibility.  
8. **GovernanceDAO.clar**: Enables token holders to vote on parameters like subsidy rates, region expansions, or ISP partnerships.

## 🛠 How It Works

**For Students**  
- Get enrolled and verified by your school (via EnrollmentVerifier).  
- Receive subsidized access tokens automatically through DistributionManager.  
- Use tokens at partnered ISPs to unlock data packages—redeem via RedemptionGateway.  

**For Schools/Verifiers**  
- Submit enrollment proofs to OracleIntegrator for secure on-chain validation.  
- Monitor distributions and usage via UsageTracker for reporting.  

**For Donors**  
- Contribute STX or assets to FundingPool to mint new access tokens.  
- Vote on governance proposals in GovernanceDAO to influence the project's direction.  
- View transparent reports on how funds are used and impact metrics.  

**For ISPs**  
- Register as a partner through GovernanceDAO.  
- Redeem student tokens via RedemptionGateway for reimbursements.  
- Track payouts and usage logs immutably on-chain.  

That's it! A decentralized network empowering education through affordable internet, with zero trust issues. Deploy on Stacks for Bitcoin-secured transactions.