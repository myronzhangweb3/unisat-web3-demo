import {Buffer} from "buffer";
import axios from "axios";
import {bitcoin, Network, testnet} from "bitcoinjs-lib/src/networks";

const bitcoinlib = require('./bitcoinjs-lib.js');

export async function buildOpReturnTxRaw(network: Network, userAddress: string, toAddress: string, amountToSend: number, message: string, signPsbt: any) {
    // network = testnet;
    // TODO only support main net
    network = bitcoin;
    console.log("network: ", network)
    console.log("userAddress: ", userAddress)
    console.log("toAddress: ", toAddress)
    console.log("amountToSend: ", amountToSend)
    console.log("message: ", message)
    const {
        data: {data: userBalanceUTXO},
    } = await axios({
        method: "GET",
        url: "https://wallet-api.unisat.io/v5/address/btc-utxo",
        params: {
            address: userAddress,
        },
    });

    const psbt = new bitcoinlib.Psbt({
        network,
    });

    // TODO if need multi input?
    const input= await buildInput(userBalanceUTXO[0], 0)
    psbt.addInput(input);
    psbt.setInputSequence(0, 4294967293);

    psbt.addOutput({
        address: toAddress,
        value: amountToSend
    });

    const data: Buffer = Buffer.from(message, 'hex'); // 使用 buffer 包
    const opReturnOutput: Buffer = bitcoinlib.script.compile([
        bitcoinlib.opcodes.OP_RETURN,
        data
    ]);
    psbt.addOutput({
        script: opReturnOutput,
        value: 0
    });

    // TODO how to set fee?
    const fee: number = 1000;
    const totalInputValue: number = userBalanceUTXO[0].satoshis;
    const changeValue: number = totalInputValue - amountToSend - fee;
    console.log("changeValue: ", changeValue)

    // 找零
    if (changeValue > 0) {
        psbt.addOutput({
            address: userAddress,
            value: changeValue // 修正找零值
        });
    }

    const signHex = await signPsbt(psbt.toBuffer().toString("hex"), {
        autoFinalized: false,
        signInputs: {
            [userAddress]: [0, 1],
        },
    });
    console.log("signHex:", signHex)

    const psbt2 = bitcoinlib.Psbt.fromHex(signHex, {network});
    psbt2.finalizeAllInputs();

    const tx = psbt2.extractTransaction();
    return tx.toHex();
}

const AddressType = {
    P2PKH: 0,
    P2WPKH: 1,
    P2TR: 2,
    P2SH_P2WPKH: 3,
    M44_P2WPKH: 4,
    M44_P2TR: 5,
    0: "P2PKH",
    1: "P2WPKH",
    2: "P2TR",
    3: "P2SH_P2WPKH",
    4: "M44_P2WPKH",
    5: "M44_P2TR",
};

const SatMap = {
    1: 68,
    2: 57.5,
    3: 91,
    4: 68,
    5: 57.5,
    0: 148,
};

async function buildInput(utxo: any, index: number) {
    const {data} = await axios({
        method: "GET",
        url: "https://mempool.space/api/tx/" + utxo.txid + "/hex",
    });
    if (
        utxo.addressType === AddressType.P2TR ||
        utxo.addressType === AddressType.M44_P2TR
    )
        return {
            hash: utxo.txid,
            index,
            witnessUtxo: {
                value: utxo.satoshis,
                script: Buffer.from(utxo.scriptPk, "hex"),
            },
            tapInternalKey: tapInternalKeyHandle(Buffer.from(utxo.pubkey, "hex")),
            nonWitnessUtxo: Buffer.from(utxo.output, "hex"),
        };

    if (utxo.addressType === AddressType.P2WPKH) {
        return {
            hash: utxo.txid,
            index,
            witnessUtxo: {
                value: utxo.satoshis,
                script: Buffer.from(utxo.scriptPk, "hex"),
            },
        };
    }

    if (
        utxo.addressType === AddressType.M44_P2WPKH ||
        utxo.addressType === AddressType.P2PKH
    )
        return {
            hash: utxo.txid,
            index,
            witnessUtxo: {
                value: utxo.satoshis,
                script: Buffer.from(utxo.scriptPk, "hex"),
            },
            nonWitnessUtxo: Buffer.from(data, "hex"),
        };
}

function tapInternalKeyHandle(buffer: any) {
    return 32 === buffer.length ? buffer : buffer.slice(1, 33);
}