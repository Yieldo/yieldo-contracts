// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IVaultAdapter.sol";

/// Bridge between Yieldo's DepositRouter and Hyperbeat's custom-staking vaults
/// (lstHYPE, liquidHYPE — Hyperbeat's "Insurance Contract" deposit pattern).
///
/// Hyperbeat staking-vault signature (selector 0xc98444f7):
///   deposit(address tokenIn, address recipient, uint256 amount, bytes32 referrerId)
/// Different from:
///   - ERC-4626:           deposit(uint256 assets, address receiver)
///   - Upshift 3-arg:      deposit(address asset, uint256 amount, address receiver)
///   - Midas depositInstant: depositInstant(address tokenIn, uint256 amountToken18, uint256 minReceive, bytes32 referrerId)
///
/// Uses an internal `insuranceContracts[shareToken] -> IC` mapping so a single
/// adapter handles every Hyperbeat staking vault. Caller must pass shareToken
/// as the `vault` arg in calldata so the router's invariant checks
/// (IERC20(vault).balanceOf) work against a real share-bearing token.
contract HyperbeatStakingAdapter is IVaultAdapter, Ownable {
    using SafeERC20 for IERC20;

    /// shareToken => Insurance Contract (the deposit destination)
    mapping(address => address) public insuranceContracts;

    event InsuranceContractSet(address indexed shareToken, address indexed ic);

    constructor(address _owner) Ownable(_owner) {}

    function setInsuranceContract(address shareToken, address ic) external onlyOwner {
        insuranceContracts[shareToken] = ic;
        emit InsuranceContractSet(shareToken, ic);
    }

    function setInsuranceContractBatch(
        address[] calldata shareTokens,
        address[] calldata ics
    ) external onlyOwner {
        require(shareTokens.length == ics.length, "HyperbeatAdapter: length mismatch");
        for (uint256 i = 0; i < shareTokens.length; i++) {
            insuranceContracts[shareTokens[i]] = ics[i];
            emit InsuranceContractSet(shareTokens[i], ics[i]);
        }
    }

    function deposit(
        address vault,         // share token — used by router for invariant checks
        address asset,
        uint256 amount,
        address recipient
    ) external override returns (uint256 shares) {
        require(amount > 0, "HyperbeatAdapter: zero amount");
        address ic = insuranceContracts[vault];
        require(ic != address(0), "HyperbeatAdapter: insurance contract not set");

        uint256 sharesBefore = IERC20(vault).balanceOf(recipient);

        IERC20(asset).forceApprove(ic, amount);

        // Hyperbeat staking custom 4-arg deposit. Selector 0xc98444f7.
        // referrerId = 0 (we attribute via partnerId on the router itself).
        (bool ok, bytes memory rd) = ic.call(
            abi.encodeWithSelector(
                bytes4(0xc98444f7),
                asset,
                recipient,
                amount,
                bytes32(0)
            )
        );
        if (!ok) {
            // Bubble up the revert reason for easier diagnosis upstream
            assembly {
                revert(add(rd, 32), mload(rd))
            }
        }

        IERC20(asset).forceApprove(ic, 0);

        shares = IERC20(vault).balanceOf(recipient) - sharesBefore;
        require(shares > 0, "HyperbeatAdapter: zero shares minted");
    }
}
