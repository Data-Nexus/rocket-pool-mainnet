import { BalancesUpdated } from "../../generated/rocketNetworkBalances/rocketNetworkBalances";
import { rocketTokenRETH } from "../../generated/rocketNetworkBalances/rocketTokenRETH";
import { rocketDepositPool } from "../../generated/rocketNetworkBalances/rocketDepositPool";
import { Staker, NetworkStakerBalanceCheckpoint, RocketPoolProtocol } from "../../generated/schema";
import { generalUtilities } from "../utilities/generalUtilities";
import { stakerUtilities } from "../utilities/stakerutilities";
import { rocketPoolEntityFactory } from "../entityfactory";
import {
  ZERO_ADDRESS_STRING,
  ROCKET_DEPOSIT_POOL_CONTRACT_ADDRESS,
  ROCKET_TOKEN_RETH_CONTRACT_ADDRESS,
} from "./../constants/contractconstants";
import { Address, BigInt } from "@graphprotocol/graph-ts";

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
  if (stakerUtilities.hasNetworkStakerBalanceCheckpointHasBeenIndexed(protocol, event)) return;

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

  // Handle the staker impact.
  generateStakerBalanceCheckpoints(
    protocol.activeStakers,
    checkpoint,
    previousCheckpoint !== null ? previousCheckpoint : null,
    previousRETHExchangeRate,
    event.block.number,
    event.block.timestamp,
    protocol
  );

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
 * Loops through all stakers of the protocol.
 * If an active rETH balance is found..
 * Create a StakerBalanceCheckpoint
 */
function generateStakerBalanceCheckpoints(
  activeStakerIds: Array<string>,
  networkCheckpoint: NetworkStakerBalanceCheckpoint,
  previousCheckpoint: NetworkStakerBalanceCheckpoint | null,
  previousRETHExchangeRate: BigInt,
  blockNumber: BigInt,
  blockTime: BigInt,
  protocol: RocketPoolProtocol
): void {
  // Update grand totals based on previous checkpoint before we do anything.
  stakerUtilities.updateNetworkStakerBalanceCheckpointForPreviousCheckpointAndProtocol(networkCheckpoint, previousCheckpoint, protocol);

  // Loop through all the staker id's in the protocol.
  for (let index = 0; index < activeStakerIds.length; index++) {
    // Determine current staker ID.
    let stakerId = <string>activeStakerIds[index];
    if (stakerId == null || stakerId == ZERO_ADDRESS_STRING) continue;

    // Load the indexed staker.
    let staker = Staker.load(stakerId);

    // Shouldn't occur since we're only passing in staker ID's that have an active rETH balance.
    if (staker === null || staker.rETHBalance == BigInt.fromI32(0)) continue;

    // Get the current & previous balances for this staker and update the staker balance for the current exchange rate.
    let stakerBalance = stakerUtilities.getStakerBalance(<Staker>staker, networkCheckpoint.rETHExchangeRate);
    staker.ethBalance = stakerBalance.currentETHBalance;

    // Calculate rewards (+/-) for this staker since the previous checkpoint.
    let ethRewardsSincePreviousCheckpoint = stakerUtilities.getETHRewardsSincePreviousStakerBalanceCheckpoint(
      stakerBalance.currentRETHBalance,
      stakerBalance.currentETHBalance,
      stakerBalance.previousRETHBalance,
      stakerBalance.previousETHBalance,
      previousRETHExchangeRate,
      networkCheckpoint.rETHExchangeRate
    );
    stakerUtilities.handleEthRewardsSincePreviousCheckpoint(ethRewardsSincePreviousCheckpoint, <Staker>staker, networkCheckpoint, protocol);

    // Create a new staker balance checkpoint
    let stakerBalanceCheckpoint = rocketPoolEntityFactory.createStakerBalanceCheckpoint(
      networkCheckpoint.id + " - " + stakerId,
      staker,
      networkCheckpoint,
      stakerBalance.currentETHBalance,
      stakerBalance.currentRETHBalance,
      staker.totalETHRewards,
      blockNumber,
      blockTime
    );
    if (stakerBalanceCheckpoint == null) continue;
    staker.lastBalanceCheckpoint = stakerBalanceCheckpoint.id;

    // Index both the updated staker & the new staker balance checkpoint.
    stakerBalanceCheckpoint.save();
    staker.save();
  }
}

/**
 * The RocketETH contract balance is equal to the total collateral - the excess deposit pool balance.
 */
function getRocketETHBalance(depositPoolExcess: BigInt, rocketETHTotalCollateral: BigInt): BigInt {
  let totalStakerETHInRocketEthContract = rocketETHTotalCollateral.minus(depositPoolExcess);

  if (totalStakerETHInRocketEthContract < BigInt.fromI32(0)) totalStakerETHInRocketEthContract = BigInt.fromI32(0);

  return totalStakerETHInRocketEthContract;
}
