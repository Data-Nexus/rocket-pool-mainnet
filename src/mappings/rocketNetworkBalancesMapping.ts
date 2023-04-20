import {BalancesUpdated} from "../../generated/rocketNetworkBalances/rocketNetworkBalances";
import {rocketTokenRETH} from "../../generated/rocketNetworkBalances/rocketTokenRETH";
import {rocketDepositPool} from "../../generated/rocketNetworkBalances/rocketDepositPool";
import {Staker, NetworkStakerBalanceCheckpoint, RocketPoolProtocol, RocketETHDailySnapshot} from "../../generated/schema";
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
  if (previousCheckpoint && checkpoint) {
    let snapshotId = checkpoint.blockTime.div(BigInt.fromI32(86400));
    let rocketETHDailySnapshot = RocketETHDailySnapshot.load(snapshotId.toString());
    let previousSnapshotId = previousCheckpoint.blockTime.div(BigInt.fromI32(86400));
    let previousRocketETHDailySnapshot = RocketETHDailySnapshot.load(snapshotId.toString());

    //if snapshotId doesn't load a record, we're in a new day and need to stradle the rewards
    if (!rocketETHDailySnapshot) {
      //find the timestamp for the start of the new day
      let dayMarker = snapshotId.times(BigInt.fromI32(86400));
      //calculate the % of time that the checkpoint is in the new day versus the prior
      let priorDayPercentage = previousCheckpoint.blockTime
        .minus(dayMarker)
        .toBigDecimal()
        .div(checkpoint.blockTime.minus(previousCheckpoint.blockTime).toBigDecimal());

      // find the prior day to update, calculate what percentage of the checkpoint was in the previous day
      // multiply the difference by the percentage and add it to the prior value.
      if (previousRocketETHDailySnapshot) {
        let midnightExchange = checkpoint.rETHExchangeRate;
        let midnightDifference = midnightExchange.minus(previousRocketETHDailySnapshot.rETHExchangeRate);
        midnightDifference = BigInt.fromString(
          midnightDifference
            .toBigDecimal()
            .times(priorDayPercentage)
            .toString()
        );
        midnightExchange = previousRocketETHDailySnapshot.rETHExchangeRate.plus(midnightDifference);

        previousRocketETHDailySnapshot.save();
      }

      rocketETHDailySnapshot = new RocketETHDailySnapshot(snapshotId.toString());
      rocketETHDailySnapshot.stakerETHActivelyStaking = checkpoint.stakerETHActivelyStaking; //BigInt!
      rocketETHDailySnapshot.stakerETHWaitingInDepositPool = checkpoint.stakerETHWaitingInDepositPool; //BigInt!
      rocketETHDailySnapshot.stakerETHInRocketETHContract = checkpoint.stakerETHInRocketETHContract; //BigInt!
      rocketETHDailySnapshot.stakerETHInProtocol = checkpoint.stakerETHInProtocol; //BigInt!
      rocketETHDailySnapshot.totalStakerETHRewards = checkpoint.totalStakerETHRewards; //BigInt!
      rocketETHDailySnapshot.totalStakersWithETHRewards = checkpoint.totalStakersWithETHRewards; //BigInt!
      rocketETHDailySnapshot.averageStakerETHRewards = checkpoint.averageStakerETHRewards; //BigInt!
      rocketETHDailySnapshot.stakersWithAnRETHBalance = checkpoint.stakersWithAnRETHBalance; //BigInt!
      rocketETHDailySnapshot.totalRETHSupply = checkpoint.totalRETHSupply; //BigInt!
      rocketETHDailySnapshot.rETHExchangeRate = checkpoint.rETHExchangeRate; //BigInt!
      rocketETHDailySnapshot.block = checkpoint.block;
      rocketETHDailySnapshot.blockTime = checkpoint.blockTime;
      rocketETHDailySnapshot.save();
    }
    //if the snapshotId loads a record, then we have 2 snapshots for the same day
    else {
      rocketETHDailySnapshot.stakerETHActivelyStaking = checkpoint.stakerETHActivelyStaking;
      rocketETHDailySnapshot.stakerETHWaitingInDepositPool = checkpoint.stakerETHWaitingInDepositPool;
      rocketETHDailySnapshot.stakerETHInRocketETHContract = checkpoint.stakerETHInRocketETHContract;
      rocketETHDailySnapshot.stakerETHInProtocol = checkpoint.stakerETHInProtocol;
      rocketETHDailySnapshot.totalStakerETHRewards = checkpoint.totalStakerETHRewards;
      rocketETHDailySnapshot.totalStakersWithETHRewards = checkpoint.totalStakersWithETHRewards;
      rocketETHDailySnapshot.averageStakerETHRewards = checkpoint.averageStakerETHRewards;
      rocketETHDailySnapshot.stakersWithAnRETHBalance = checkpoint.stakersWithAnRETHBalance;
      rocketETHDailySnapshot.totalRETHSupply = checkpoint.totalRETHSupply;
      rocketETHDailySnapshot.rETHExchangeRate = checkpoint.rETHExchangeRate;
      rocketETHDailySnapshot.block = checkpoint.block;
      rocketETHDailySnapshot.blockTime = checkpoint.blockTime;

      rocketETHDailySnapshot.save();
    }
  }

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
