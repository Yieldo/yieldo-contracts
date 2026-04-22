// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IVaultAdapter {
    function deposit(
        address vault,
        address asset,
        uint256 amount,
        address recipient
    ) external returns (uint256 shares);
}
