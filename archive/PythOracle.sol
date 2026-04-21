// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "../interfaces/IPriceOracle.sol";

contract PythOracle is IPriceOracle, Ownable {
    IPyth public pyth;
    uint256 public priceMaxAge;
    mapping(address => bytes32) public priceFeedIds;

    event PythUpdated(address indexed newPyth);
    event PriceMaxAgeUpdated(uint256 newMaxAge);
    event PriceFeedSet(address indexed asset, bytes32 feedId);

    constructor(address _pyth, uint256 _priceMaxAge, address _owner) Ownable(_owner) {
        require(_pyth != address(0), "Invalid pyth");
        require(_priceMaxAge > 0, "Invalid max age");
        pyth = IPyth(_pyth);
        priceMaxAge = _priceMaxAge;
    }

    function setPyth(address _pyth) external onlyOwner {
        require(_pyth != address(0), "Invalid pyth");
        pyth = IPyth(_pyth);
        emit PythUpdated(_pyth);
    }

    function setPriceMaxAge(uint256 _priceMaxAge) external onlyOwner {
        require(_priceMaxAge > 0, "Invalid max age");
        priceMaxAge = _priceMaxAge;
        emit PriceMaxAgeUpdated(_priceMaxAge);
    }

    function setPriceFeed(address asset, bytes32 feedId) external onlyOwner {
        priceFeedIds[asset] = feedId;
        emit PriceFeedSet(asset, feedId);
    }

    function setPriceFeedsBatch(address[] calldata assets, bytes32[] calldata feedIds) external onlyOwner {
        require(assets.length == feedIds.length, "Length mismatch");
        for (uint256 i = 0; i < assets.length; i++) {
            priceFeedIds[assets[i]] = feedIds[i];
            emit PriceFeedSet(assets[i], feedIds[i]);
        }
    }

    function hasFeed(address asset) external view override returns (bool) {
        return priceFeedIds[asset] != bytes32(0);
    }

    function getUsdValue(address asset, uint256 amount) external view override returns (uint256) {
        bytes32 feedId = priceFeedIds[asset];
        require(feedId != bytes32(0), "No feed for asset");

        PythStructs.Price memory price = pyth.getPriceNoOlderThan(feedId, priceMaxAge);
        require(price.price > 0, "Invalid price");

        uint256 absPrice = uint256(uint64(price.price));
        uint8 assetDecimals = IERC20Metadata(asset).decimals();

        uint256 numerator = amount * absPrice;
        int256 shift = int256(uint256(assetDecimals)) + int256(int32(-price.expo)) - 18;

        if (shift > 0) {
            return numerator / (10 ** uint256(shift));
        } else if (shift < 0) {
            return numerator * (10 ** uint256(-shift));
        } else {
            return numerator;
        }
    }

    function getUpdateFee(bytes[] calldata priceUpdate) external view returns (uint256) {
        return pyth.getUpdateFee(priceUpdate);
    }

    function updatePriceFeeds(bytes[] calldata priceUpdate) external payable {
        uint256 updateFee = pyth.getUpdateFee(priceUpdate);
        pyth.updatePriceFeeds{value: updateFee}(priceUpdate);
        if (msg.value > updateFee) {
            (bool success, ) = msg.sender.call{value: msg.value - updateFee}("");
            require(success, "Refund failed");
        }
    }
}
