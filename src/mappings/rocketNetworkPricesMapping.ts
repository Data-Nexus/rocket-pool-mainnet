import { PricesUpdated } from "../../generated/rocketNetworkPrices/rocketNetworkPrices";
import { rocketNetworkFees } from "../../generated/rocketNetworkPrices/rocketNetworkFees";
import { rocketStorage } from "../../generated/rocketNetworkPrices/rocketStorage";
import { rocketDAOProtocolSettingsMinipool } from "../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsMinipool";
import { rocketDAOProtocolSettingsNode } from "../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsNode";
import { rocketNodeStaking } from "../../generated/rocketNetworkPrices/rocketNodeStaking";
import { Node, NetworkNodeBalanceCheckpoint } from "../../generated/schema";
import { generalUtilities } from "../utilities/generalUtilities";
import { rocketPoolEntityFactory } from "../entityfactory";
import { NetworkNodeBalanceMinipoolMetadata } from "../models/networkNodeBalanceMinipoolMetadata";
import {
  ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL,
  ROCKET_DAO_PROTOCOL_SETTINGS_NODE,
  ROCKET_NETWORK_FEES_CONTRACT_NAME,
  ROCKET_STORAGE_ADDRESS,
  ROCKET_NODE_STAKING_CONTRACT_NAME
} from "./../constants/contractconstants";
import { BigInt, Address } from "@graphprotocol/graph-ts";
import { nodeUtilities } from "../utilities/nodeutilities";
import { EffectiveMinipoolRPLBounds } from "../models/effectiveMinipoolRPLBounds";

/**
 * When enough ODAO members submitted their votes and a consensus threshold is reached, a new RPL price is comitted to the smart contracts.
 */
export function handlePricesUpdated(event: PricesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (nodeUtilities.hasNetworkNodeBalanceCheckpointHasBeenIndexed(event))
    return;

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity();
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol();
  }
  if (protocol === null) return;

  // Define the rocket storage contract, we are going to need it to query the current smart contract state.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);

  // Determine the fee for a new minipool.
  let nodeFeeForNewMinipool = getNewMinipoolFee(rocketStorageContract);

  // Determine the RPL minimum and maximum for a new minipool.
  let effectiveRPLBoundsNewMinipool = getEffectiveMinipoolRPLBounds(
    event.params.rplPrice,
    rocketStorageContract
  );

  // Create a new network node balance checkpoint.
  let checkpoint = rocketPoolEntityFactory.createNetworkNodeBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    protocol.lastNetworkNodeBalanceCheckPoint,
    effectiveRPLBoundsNewMinipool.minimum,
    effectiveRPLBoundsNewMinipool.maximum,
    event.params.rplPrice,
    nodeFeeForNewMinipool,
    event.block.number,
    event.block.timestamp
  );
  if (checkpoint === null) return;

  // Retrieve the previous network node checkpoint & store some of the running totals it holds for later.
  let previousCheckpoint: NetworkNodeBalanceCheckpoint | null = null;
  let previousCheckpointId = protocol.lastNetworkNodeBalanceCheckPoint;
  if (previousCheckpointId != null) {
    previousCheckpoint = NetworkNodeBalanceCheckpoint.load(
      <string>previousCheckpointId
    );
    if (previousCheckpoint !== null) {
      previousCheckpoint.nextCheckpointId = checkpoint.id;
    }
  }

  // Handle the node impact.
  let minipoolMetadata = generateNodeBalanceCheckpoints(
    protocol.nodes,
    <NetworkNodeBalanceCheckpoint>checkpoint,
    rocketStorageContract,
    event.block.number,
    event.block.timestamp
  );

  // Some of the running totals should be set to the ones from the previous checkpoint if they are 0 after generating the individual node balance checkpoints.
  nodeUtilities.coerceRunningTotalsBasedOnPreviousCheckpoint(
    <NetworkNodeBalanceCheckpoint>checkpoint,
    previousCheckpoint
  );

  // Update certain totals/averages based on minipool metadata.
  nodeUtilities.updateNetworkNodeBalanceCheckpointForMinipoolMetadata(
    <NetworkNodeBalanceCheckpoint>checkpoint,
    minipoolMetadata
  );

  // Update the link so the protocol points to the last network node balance checkpoint.
  protocol.lastNetworkNodeBalanceCheckPoint = checkpoint.id;

  // Index these changes.
  checkpoint.save();
  if (previousCheckpoint !== null) previousCheckpoint.save();
  protocol.save();
}

/**
 * Loops through all nodes of the protocol.
 * Create a NodeBalanceCheckpoint
 */
function generateNodeBalanceCheckpoints(
  nodeIds: Array<string>,
  networkCheckpoint: NetworkNodeBalanceCheckpoint,
  rocketStorageContract: rocketStorage,
  blockNumber: BigInt,
  blockTime: BigInt
): NetworkNodeBalanceMinipoolMetadata {
  let minipoolMetadata = new NetworkNodeBalanceMinipoolMetadata();

  // If we don't have any registered nodes at this time, stop.
  if (nodeIds.length === 0) return minipoolMetadata;

  // We will need the rocket node staking contract to get some latest state for the associated node.
  let rocketNodeStakingContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_NODE_STAKING_CONTRACT_NAME
    )
  );
  let rocketNodeStakingContract = rocketNodeStaking.bind(
    rocketNodeStakingContractAddress
  );

  // Loop through all the node id's in the protocol.
  for (let index = 0; index < nodeIds.length; index++) {
    // Determine current node ID.
    let nodeId = <string>nodeIds[index];
    if (nodeId == null) continue;

    // Load the indexed node.
    let node = Node.load(nodeId);
    if (node === null) continue;

    // We'll need this to pass to the rocketnodestaking contract.
    let nodeAddress = Address.fromString(node.id);

    // Update the node state that is affected by the update in RPL/ETH price.
    node.effectiveRPLStaked = rocketNodeStakingContract.getNodeEffectiveRPLStake(
      nodeAddress
    );
    node.minimumEffectiveRPL = rocketNodeStakingContract.getNodeMinimumRPLStake(
      nodeAddress
    );
    node.maximumEffectiveRPL = rocketNodeStakingContract.getNodeMaximumRPLStake(
      nodeAddress
    );

    // Update network balance(s) based on this node.
    nodeUtilities.updateNetworkNodeBalanceCheckpointForNode(
      networkCheckpoint,
      <Node>node
    );

    // We need this to calculate the min/max effective RPL needed for the network.
    nodeUtilities.updateMinipoolMetadataWithNode(minipoolMetadata, <Node>node);

    // Create a new node balance checkpoint
    let nodeBalanceCheckpoint = rocketPoolEntityFactory.createNodeBalanceCheckpoint(
      networkCheckpoint.id + " - " + node.id,
      networkCheckpoint.id,
      <Node>node,
      blockNumber,
      blockTime
    );
    if (nodeBalanceCheckpoint == null) continue;
    node.lastNodeBalanceCheckpoint = nodeBalanceCheckpoint.id;

    // Keep track of the highest RPL rewards claimed rank for this checkpoint.
    if(node.totalRPLClaimedRewardsRank == BigInt.fromI32(1)) {
       networkCheckpoint.checkpointWithHighestRPLRewardsRank = nodeBalanceCheckpoint.id;
    }

    // Index both the updated node & the new node balance checkpoint.
    nodeBalanceCheckpoint.save();
    node.save();
  }

  return minipoolMetadata;
}

/**
 * Returns the minimum and maximum RPL needed to collateralize a new minipool based on the current smart contract state.
 */
function getEffectiveMinipoolRPLBounds(
  rplPrice: BigInt,
  rocketStorageContract: rocketStorage
): EffectiveMinipoolRPLBounds {
  let effectiveRPLBounds = new EffectiveMinipoolRPLBounds();

  // Get the DAO Protocol settings minipool contract instance.
  let rocketDAOProtocolSettingsMinipoolContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL
    )
  );
  let rocketDAOProtocolSettingsMinipoolContract = rocketDAOProtocolSettingsMinipool.bind(
    rocketDAOProtocolSettingsMinipoolContractAddress
  );

  // Get the DAO Protocol settings node contract instance.
  let rocketDAOProtocolSettingsNodeAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_PROTOCOL_SETTINGS_NODE
    )
  );
  let rocketDAOProtocolSettingsNodeContract = rocketDAOProtocolSettingsNode.bind(
    rocketDAOProtocolSettingsNodeAddress
  );

  // What is the current deposit amount a node operator has to deposit to start a minipool?
  let halfDepositAmount = rocketDAOProtocolSettingsMinipoolContract.getHalfDepositNodeAmount();

  // Determine the minimum and maximum RPL a minipool needs to be collateralized.
  effectiveRPLBounds.minimum = nodeUtilities.getMinimumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMinimumPerMinipoolStake(),
    rplPrice
  );
  effectiveRPLBounds.maximum = nodeUtilities.getMaximumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMaximumPerMinipoolStake(),
    rplPrice
  );

  return effectiveRPLBounds;
}

/**
 * Gets the new minipool fee form the smart contract state.
 */
function getNewMinipoolFee(rocketStorageContract: rocketStorage): BigInt {
  // Get the network fees contract instance.
  let networkFeesContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_NETWORK_FEES_CONTRACT_NAME
    )
  );
  let networkFeesContract = rocketNetworkFees.bind(networkFeesContractAddress);

  return networkFeesContract.getNodeFee();
}
