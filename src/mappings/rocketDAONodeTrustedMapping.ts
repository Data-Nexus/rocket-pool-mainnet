import { BigInt } from '@graphprotocol/graph-ts'
import { rocketStorage } from '../../generated/rocketDAONodeTrusted/rocketStorage';
import { DecrementMemberUnbondedValidatorCountCall, IncrementMemberUnbondedValidatorCountCall } from '../../generated/rocketDAONodeTrusted/rocketDAONodeTrusted'
import { Minipool, Node } from '../../generated/schema'
import { ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME, ROCKET_STORAGE_ADDRESS } from '../constants/contractconstants';
import { generalUtilities } from '../utilities/generalUtilities';

/**
 * Occurs after a trusted node operator creates a minipool, via the RocketMinipoolManager.
 */
export function handleIncrementMemberUnbondedValidatorCount(call: IncrementMemberUnbondedValidatorCountCall): void {
    // Preliminary null checks.
    if (call === null || call.from === null || call.inputs === null || call.inputs._nodeAddress === null) return;

    // Calling address should be the rocketMinipoolManager!
    let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
    let rocketMinipoolManagerContractAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME))
    if (rocketMinipoolManagerContractAddress === null ||
        rocketMinipoolManagerContractAddress.toHexString() != call.from.toHexString()) return

    // Retrieve the parent node. It has to exist.
    let node = Node.load(call.inputs._nodeAddress.toHexString())
    if (node === null) return

    // Increment total unbonded minipools
    node.stakingUnbondedMinipools = node.stakingUnbondedMinipools.plus(BigInt.fromI32(1));

    // Index the minipool and the associated node.
    node.save();
}

/**
 * Occurs after a minipool finalizes his unbonded validator.
 */
export function handleDecrementMemberUnbondedValidatorCount(call: DecrementMemberUnbondedValidatorCountCall): void {
    // Preliminary null checks.
    if (call === null || call.from === null || call.inputs === null || call.inputs._nodeAddress === null) return;

    // There must be a minipool with the same address as the calling address!
    let minipool = Minipool.load(call.from.toHexString())
    if (minipool === null) return

    // Retrieve the parent node. It has to exist.
    let node = Node.load(call.inputs._nodeAddress.toHexString())
    if (node === null) return

    // Decrement total unbonded minipools
    node.stakingUnbondedMinipools = node.stakingUnbondedMinipools.minus(BigInt.fromI32(1));
    if (node.stakingUnbondedMinipools < BigInt.fromI32(0)) node.stakingUnbondedMinipools = BigInt.fromI32(0);

    // Index the minipool and the associated node.
    node.save();
}