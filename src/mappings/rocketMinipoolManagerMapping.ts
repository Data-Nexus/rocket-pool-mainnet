import { Address, BigInt } from '@graphprotocol/graph-ts'
import { DecrementNodeStakingMinipoolCountCall, IncrementNodeFinalisedMinipoolCountCall, IncrementNodeStakingMinipoolCountCall, MinipoolCreated, MinipoolDestroyed } from '../../generated/rocketMinipoolManager/rocketMinipoolManager'
import { rocketNetworkFees } from '../../generated/rocketNetworkPrices/rocketNetworkFees'
import { rocketStorage } from '../../generated/rocketNodeStaking/rocketStorage'
import { rocketNodeStaking } from '../../generated/rocketNodeStaking/rocketNodeStaking'
import {
  ROCKET_STORAGE_ADDRESS,
  ROCKET_NETWORK_FEES_CONTRACT_NAME,
  ROCKET_NODE_STAKING_CONTRACT_NAME,
} from './../constants/contractconstants'
import { Minipool, Node } from '../../generated/schema'
import { rocketPoolEntityFactory } from '../entityfactory'
import { generalUtilities } from '../utilities/generalUtilities'

/**
 * Occurs when a node operator makes an ETH deposit on his node to create a minipool.
 */
export function handleMinipoolCreated(event: MinipoolCreated): void {
  // Preliminary null checks.
  if (
    event === null ||
    event.params === null ||
    event.params.node === null ||
    event.params.minipool === null
  )
    return

  // There can't be an existing minipool with the same address.
  let minipool = Minipool.load(event.params.minipool.toHexString())
  if (minipool !== null) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(event.params.node.toHexString())
  if (node === null) return

  // Create a new minipool.
  minipool = rocketPoolEntityFactory.createMinipool(
    event.params.minipool.toHexString(),
    <Node>node,
    /**
     * This will be called immediately after this event was emitted and before this minipool is queued.
     * Therefor it is safe to call the minipool fee smart contract and assume it will give the same fee
     *  that the minipool just received in its constructor.
     */
    getNewMinipoolFee()
  )
  if (minipool === null) return

  // Add this minipool to the collection of the node
  let nodeMinipools = node.minipools
  if (nodeMinipools.indexOf(minipool.id) == -1) nodeMinipools.push(minipool.id)
  node.minipools = nodeMinipools

  // Creating a minipool requires the node operator to put up a certain amount of RPL in order to receive rewards.
  setEffectiveRPLStaked(<Node>node);

  // A destroyed minipool changes the average minipool fee for a node.
  setAverageFeeForActiveMinipools(<Node>node);

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * Occurs when a minipool is dissolved and the node operator calls destroy on his minipool.
 */
export function handleMinipoolDestroyed(event: MinipoolDestroyed): void {
  // Preliminary null checks.
  if (
    event === null ||
    event.params === null ||
    event.params.node === null ||
    event.params.minipool === null ||
    event.block === null
  )
    return

  // There must be an indexed minipool.
  let minipool = Minipool.load(event.params.minipool.toHexString())
  if (minipool === null) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(event.params.node.toHexString())
  if (node === null) return

  // Destroying a minipool lowers the requirements for the node operator to put up collateral in order to receive RPL rewards.
  setEffectiveRPLStaked(<Node>node);

  // A destroyed minipool changes the average minipool fee for a node.
  setAverageFeeForActiveMinipools(<Node>node);

  // Update the minipool so it will contain its destroyed state.
  minipool.destroyedBlockTime = event.block.timestamp;

  // Index changes.
  minipool.save();
  node.save();
}

/**
 * This is only called by minipools who transition to the staking state, after they leave the queue.
 */
export function handleIncrementNodeStakingMinipoolCount(call: IncrementNodeStakingMinipoolCountCall): void {
  // Preliminary null checks.
  if (call === null || call.block === null || call.from === null) return;

  // Calling address should be a minipool with a valid link to a node.
  let minipool = Minipool.load(call.from.toHexString());
  if (minipool === null || minipool.node == null) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(minipool.node)
  if (node === null) return

  // Update the staking start time of this minipool. 
  minipool.stakingBlockTime = call.block.timestamp;
  node.stakingMinipools = node.stakingMinipools.plus(BigInt.fromI32(1));

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * This is only called by minipools who are set to withdrawable.
 */
export function handleDecrementNodeStakingMinipoolCount(call: DecrementNodeStakingMinipoolCountCall): void {
  // Preliminary null checks.
  if (call === null || call.block === null || call.from === null) return;

  // Calling address should be a minipool with a valid link to an indexed node.
  let minipool = Minipool.load(call.from.toHexString());
  if (minipool === null || minipool.node == null) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(minipool.node)
  if (node === null) return

  // Update the withdrawal block time and the total withdrawable minipool counter of this minipool.
  minipool.withdrawableBlockTime = call.block.timestamp;
  node.withdrawableMinipools = node.withdrawableMinipools.plus(BigInt.fromI32(1));

  // Decrement the number of staking minipools for the node.
  node.stakingMinipools = node.stakingMinipools.minus(BigInt.fromI32(1));
  if (node.stakingMinipools < BigInt.fromI32(0)) node.stakingMinipools = BigInt.fromI32(0);

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * Occurs after a node operator finalizes his minipool to unlock his RPL stake.
 */
export function handleIncrementNodeFinalisedMinipoolCount(call: IncrementNodeFinalisedMinipoolCountCall): void {
  // Preliminary null checks.
  if (call === null || call.block === null || call.from === null) return;

  // Calling address should be a minipool with a valid link to a node.
  let minipool = Minipool.load(call.from.toHexString());
  if (minipool === null || minipool.node == null) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(minipool.node)
  if (node === null) return

  // Update the finalized block time for this minipool and the number of total finalized minipools for the node.
  minipool.finalizedBlockTime = call.block.timestamp;
  node.totalFinalizedMinipools = node.totalFinalizedMinipools.plus(BigInt.fromI32(1));

  // Decrement the number of withdrawable minipools for the node.
  node.withdrawableMinipools = node.totalFinalizedMinipools.minus(BigInt.fromI32(1));
  if (node.withdrawableMinipools < BigInt.fromI32(0)) node.withdrawableMinipools = BigInt.fromI32(0);

  // A finalized minipool lowers the requirements for a node to put up collateral to receive rewards.
  setEffectiveRPLStaked(<Node>node);

  // A finalized minipool changes the average minipool fee for a node.
  setAverageFeeForActiveMinipools(<Node>node);

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * Gets the new minipool fee form the smart contract state.
 */
function getNewMinipoolFee(): BigInt {
  // Get the network fees contract instance.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS)
  let networkFeesContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_NETWORK_FEES_CONTRACT_NAME,
    ),
  )
  let networkFeesContract = rocketNetworkFees.bind(networkFeesContractAddress)
  if (networkFeesContract === null) return BigInt.fromI32(0)

  return networkFeesContract.getNodeFee()
}

/**
 * Sets the effective RPl staked states for a node based on the smart contract state.
 */
function setEffectiveRPLStaked(node: Node): void {
  // We need this to get the new (minimum/maximum) effective RPL staked for the node.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
  let rocketNodeStakingAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_NODE_STAKING_CONTRACT_NAME))
  let rocketNodeStakingContract = rocketNodeStaking.bind(rocketNodeStakingAddress)
  if (rocketNodeStakingContract === null) return

  // Load the effective RPL staked state from the smart contracts and update the node.
  let nodeAddress = Address.fromString(node.id);
  node.effectiveRPLStaked = rocketNodeStakingContract.getNodeEffectiveRPLStake(
    nodeAddress
  );
  node.minimumEffectiveRPL = rocketNodeStakingContract.getNodeMinimumRPLStake(
    nodeAddress
  );
  node.maximumEffectiveRPL = rocketNodeStakingContract.getNodeMaximumRPLStake(
    nodeAddress
  );
}

/**
 * Loops through all minipools of a node and sets the average fee for the active minipools.
 */
function setAverageFeeForActiveMinipools(node: Node): void {
  // Start off with an average fee of 0.
  node.averageFeeForActiveMinipools = BigInt.fromI32(0);

  // If there were no minipools, then the average fee is currently 0. 
  let minipoolIds = node.minipools;
  if (minipoolIds === null || minipoolIds.length == 0) return

  // We'll need these to calculate the average fee accross all minipools for the given node.
  let totalMinipoolFeeForActiveMinipools = BigInt.fromI32(0);
  let totalActiveMinipools = BigInt.fromI32(0);

  // Loop through all the minipool ids of the node.
  for (let index = 0; index < minipoolIds.length; index++) {
    // Get the current minipool ID for this iteration.
    let minipoolId = <string>minipoolIds[index];
    if (minipoolId == null) continue;

    // Load the indexed minipool.
    let minipool = Minipool.load(minipoolId);

    /* 
     If the minipool:
     - Wasn't indexed.
     - Is in a finalized state.
     - Is in a destroyed state.
     Then we can't use its fee to calculate the average for the node.
    */
    if (minipool === null ||
      minipool.finalizedBlockTime != BigInt.fromI32(0) ||
      minipool.destroyedBlockTime != BigInt.fromI32(0))
      continue;

    // Increment total active minipools.
    totalActiveMinipools = totalActiveMinipools.plus(BigInt.fromI32(1));

    // Increment total fee accross all minipools.
    totalMinipoolFeeForActiveMinipools = totalMinipoolFeeForActiveMinipools.plus(minipool.fee);
  }

  /*
   If the total active minipools for this node is greater than 0.
   And the total fee for the active minipools is greater than 0.
   We can calculate the average fee for active minipools for this node.
  */
  if (totalActiveMinipools > BigInt.fromI32(0) &&
    totalMinipoolFeeForActiveMinipools > BigInt.fromI32(0)) {

    node.averageFeeForActiveMinipools =
      totalMinipoolFeeForActiveMinipools.div(totalActiveMinipools);
  }
}
