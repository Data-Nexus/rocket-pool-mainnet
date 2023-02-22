import {BalancesUpdated} from "../../generated/rocketNetworkBalances/rocketNetworkBalances";
import {rocketTokenRETH} from "../../generated/rocketNetworkBalances/rocketTokenRETH";
import {rocketDepositPool} from "../../generated/rocketNetworkBalances/rocketDepositPool";
import {Staker, NetworkStakerBalanceCheckpoint, RocketPoolProtocol} from "../../generated/schema";
import {generalUtilities} from "../utilities/generalUtilities";
import {stakerUtilities} from "../utilities/stakerutilities";
import {rocketPoolEntityFactory} from "../entityfactory";
import {
  ZERO_ADDRESS_STRING,
  ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
  ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
} from "./../constants/contractconstants";
import {Address, BigInt} from "@graphprotocol/graph-ts";

/**
 * When enough ODAO members votes on a balance and a consensus threshold is reached, the staker beacon chain state is persisted to the smart contracts.
 */
export function handleBalancesUpdated(event: BalancesUpdated): void {
  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity();
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol();
  }
  if (protocol === null) return;

  // Preliminary check to ensure we haven't handled this before.
  // commented out 2/21/2023 to run data checks w/o
  //if (stakerUtilities.hasNetworkStakerBalanceCheckpointHasBeenIndexed(protocol, event)) return;

  // Load the RocketTokenRETH contract
  // We will need the rocketvault smart contract state to get specific addresses.
  let rETHContract = rocketTokenRETH.bind(Address.fromString(ROCKET_TOKEN_RETH_CONTRACT_ADDRESS));
  if (rETHContract === null) return;

  // Load the rocketDepositPool contract
  let rocketDepositPoolContract = rocketDepositPool.bind(Address.fromString(ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS));
  if (rocketDepositPoolContract === null) return;

  // How much is the total staker ETH balance in the deposit pool?
  let depositPoolBalance = rocketDepositPoolContract.getBalance();
  let depositPoolExcessBalance = rocketDepositPoolContract.getExcessBalance();

  // The RocketEth contract balance is equal to the total collateral - the excess deposit pool balance.
  let stakerETHInRocketETHContract = getRocketETHBalance(depositPoolExcessBalance, rETHContract.getTotalCollateral());

  // Attempt to create a new network balance checkpoint.
  let rETHExchangeRate = rETHContract.getExchangeRate();
  let checkpoint = rocketPoolEntityFactory.createNetworkStakerBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    protocol.lastNetworkStakerBalanceCheckPoint,
    event,
    depositPoolBalance,
    stakerETHInRocketETHContract,
    rETHExchangeRate
  );
  if (checkpoint === null) return;

  // Retrieve previous checkpoint.
  let previousCheckpointId = protocol.lastNetworkStakerBalanceCheckPoint;
  let previousTotalStakerETHRewards = BigInt.fromI32(0);
  let previousTotalStakersWithETHRewards = BigInt.fromI32(0);
  let previousRETHExchangeRate = BigInt.fromI32(1);
  let previousCheckpoint: NetworkStakerBalanceCheckpoint | null = null;
  if (previousCheckpointId) {
    previousCheckpoint = NetworkStakerBalanceCheckpoint.load(previousCheckpointId);
    if (previousCheckpoint) {
      previousTotalStakerETHRewards = previousCheckpoint.totalStakerETHRewards;
      previousTotalStakersWithETHRewards = previousCheckpoint.totalStakersWithETHRewards;
      previousRETHExchangeRate = previousCheckpoint.rETHExchangeRate;
      previousCheckpoint.nextCheckpointId = checkpoint.id;
    }
  }

  //Add logic for rETH timeseries

  // If for some reason the running summary totals up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (checkpoint.totalStakerETHRewards == BigInt.fromI32(0)) {
    checkpoint.totalStakerETHRewards = previousTotalStakerETHRewards;
  }
  if (checkpoint.totalStakersWithETHRewards == BigInt.fromI32(0)) {
    checkpoint.totalStakersWithETHRewards = previousTotalStakersWithETHRewards;
  }

  // Calculate average staker reward up to this checkpoint.
  if (
    checkpoint.totalStakerETHRewards != BigInt.fromI32(0) && checkpoint.totalStakersWithETHRewards
      ? 0
      : checkpoint.totalStakersWithETHRewards >= BigInt.fromI32(1)
  ) {
    checkpoint.averageStakerETHRewards = checkpoint.totalStakerETHRewards.div(checkpoint.totalStakersWithETHRewards);
  }

  // Update the link so the protocol points to the last network staker balance checkpoint.
  protocol.lastNetworkStakerBalanceCheckPoint = checkpoint.id;

  // Index these changes.
  checkpoint.save();
  if (previousCheckpoint !== null) previousCheckpoint.save();
  protocol.save();
}

/**
 * The RocketETH contract balance is equal to the total collateral - the excess deposit pool balance.
 */
function getRocketETHBalance(depositPoolExcess: BigInt, rocketETHTotalCollateral: BigInt): BigInt {
  let totalStakerETHInRocketEthContract = rocketETHTotalCollateral.minus(depositPoolExcess);

  if (totalStakerETHInRocketEthContract < BigInt.fromI32(0)) totalStakerETHInRocketEthContract = BigInt.fromI32(0);

  return totalStakerETHInRocketEthContract;
}
