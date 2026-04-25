// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IVaultAdapter.sol";

interface IUpshiftOrchestrator {
    function deposit(address asset, uint256 amount, address receiver) external returns (uint256);
}

/// Bridge between Yieldo's DepositRouter and Upshift's multi-contract vaults.
///
/// Upshift architecture:
///   - Orchestrator contract: implements deposit(address asset, uint256 amount, address receiver)
///   - Share token (separate ERC-20): what depositors actually receive
///
/// Router checks IERC20(vault).balanceOf(recipient) to verify shares delivered,
/// so the `vault` arg passed in calldata MUST be the share token (a real ERC-20),
/// not the orchestrator. We store the share→orchestrator mapping here so the
/// adapter can route the actual deposit call to the right orchestrator.
contract UpshiftAdapter is IVaultAdapter, Ownable {
    using SafeERC20 for IERC20;

    /// shareToken => orchestrator (the contract that exposes the 3-arg deposit)
    mapping(address => address) public orchestrators;

    event OrchestratorSet(address indexed shareToken, address indexed orchestrator);

    constructor(address _owner) Ownable(_owner) {}

    function setOrchestrator(address shareToken, address orchestrator) external onlyOwner {
        orchestrators[shareToken] = orchestrator;
        emit OrchestratorSet(shareToken, orchestrator);
    }

    function setOrchestratorBatch(
        address[] calldata shareTokens,
        address[] calldata orcs
    ) external onlyOwner {
        require(shareTokens.length == orcs.length, "UpshiftAdapter: length mismatch");
        for (uint256 i = 0; i < shareTokens.length; i++) {
            orchestrators[shareTokens[i]] = orcs[i];
            emit OrchestratorSet(shareTokens[i], orcs[i]);
        }
    }

    function deposit(
        address vault,         // share token — used by router for invariant checks
        address asset,
        uint256 amount,
        address recipient
    ) external override returns (uint256 shares) {
        require(amount > 0, "UpshiftAdapter: zero amount");
        address orch = orchestrators[vault];
        require(orch != address(0), "UpshiftAdapter: orchestrator not set");

        uint256 sharesBefore = IERC20(vault).balanceOf(recipient);

        IERC20(asset).forceApprove(orch, amount);
        IUpshiftOrchestrator(orch).deposit(asset, amount, recipient);
        IERC20(asset).forceApprove(orch, 0);

        shares = IERC20(vault).balanceOf(recipient) - sharesBefore;
        require(shares > 0, "UpshiftAdapter: zero shares minted");
    }
}
