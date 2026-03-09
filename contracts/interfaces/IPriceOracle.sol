// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IPriceOracle {
    /// @notice Returns the USD value of `amount` of `asset` in 18-decimal fixed point.
    /// @dev Must revert if the price is stale or unavailable.
    function getUsdValue(address asset, uint256 amount) external view returns (uint256);

    /// @notice Returns true if the oracle has a price feed configured for `asset`.
    function hasFeed(address asset) external view returns (bool);
}
