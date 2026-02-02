/**
 * 基于 Solana Kit v5 与链上数据存储程序交互
 *
 * 功能：save / load / update / demo
 * 参数与 scripts/deploy.ts 一致：--cluster、--keypair、.env 等
 */

import {
  address,
  type Address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  type KeyPairSigner,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  pipe,
  getSignatureFromTransaction,
  getBase58Encoder,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "@solana/kit";
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

const DEFAULT_CLUSTER_URLS: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localhost: "http://localhost:8899",
};

const DEFAULT_PROGRAM_ID = process.env.PROGRAM_ID ?? "43bTR3Fwtq3zYRiR1Yz4dNYhaWgCHPWVbsMNag369nYx";

const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const SYSVAR_RENT_ID = address("SysvarRent111111111111111111111111111111111");

const base58Encoder = getBase58Encoder();

function getClusterUrl(cluster: string, clusterFromArgs: boolean): string {
  if (clusterFromArgs && DEFAULT_CLUSTER_URLS[cluster]) {
    return DEFAULT_CLUSTER_URLS[cluster];
  }
  if (process.env.RPC_URL) {
    return process.env.RPC_URL;
  }
  return DEFAULT_CLUSTER_URLS[cluster] ?? DEFAULT_CLUSTER_URLS.devnet;
}

function parseArgs(): {
  cluster: string;
  keypair: string;
  programId: string;
  clusterFromArgs: boolean;
  command: string | undefined;
  commandArgs: string[];
} {
  const raw = process.argv.slice(2);
  let cluster = "devnet";
  let keypair = process.env.SOLANA_KEYPAIR ?? path.join(process.env.HOME ?? "", ".config", "solana", "id.json");
  let programId = process.env.PROGRAM_ID ?? DEFAULT_PROGRAM_ID;
  let clusterFromArgs = false;
  const commandArgs: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case "--cluster":
        cluster = raw[++i] ?? "devnet";
        clusterFromArgs = true;
        break;
      case "--keypair":
      case "-k":
        keypair = raw[++i] ?? keypair;
        break;
      case "--program-id":
        programId = raw[++i] ?? programId;
        break;
      case "--help":
      case "-h":
        console.log(`
用法: npm run interact:<cmd> [选项] [参数]
       npx tsx scripts/interact.ts <command> [选项] [参数]

命令:
  save <message>   写入数据到链上
  load             从链上读取数据
  update <message> 更新数据并读回
  demo             演示：save -> load -> update -> load

选项（与 deploy 一致）:
  --cluster <name>     mainnet-beta | devnet | testnet | localhost (默认: devnet)
  --keypair, -k <path> keypair 路径 (默认: ~/.config/solana/id.json)
  --program-id <id>    程序 ID（默认: 环境变量 PROGRAM_ID 或内置默认）
  --help, -h           显示此帮助

环境变量（.env）:
  RPC_URL          RPC 地址
  SOLANA_KEYPAIR   keypair 路径
  PROGRAM_ID       程序 ID（与 deploy 部署后一致时可设）

优先级: 命令行参数 > 环境变量 > 默认值
`);
        process.exit(0);
      default:
        commandArgs.push(raw[i]!);
    }
  }

  const command = commandArgs.shift();
  return { cluster, keypair, programId, clusterFromArgs, command, commandArgs };
}

async function loadKeypairFromFile(keypairPath: string): Promise<KeyPairSigner> {
  const expanded = keypairPath.replace(/^~/, process.env.HOME ?? "");
  const bytes = new Uint8Array(JSON.parse(fs.readFileSync(expanded, "utf-8")));
  return createKeyPairSignerFromBytes(bytes);
}

async function derivePDA(programId: Address, userPubkey: Address): Promise<Address> {
  const [pda,_] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [getAddressEncoder().encode(userPubkey)],
  });
  return pda;
}

interface AccountMeta {
  address: Address;
  role: number;
}

function createInstruction(programId: Address, accounts: AccountMeta[], data: Uint8Array) {
  return {
    programAddress: programId,
    accounts: accounts.map(acc => ({
      address: acc.address,
      role: (acc.role & 2 ? (acc.role & 1 ? 3 : 2) : (acc.role & 1 ? 1 : 0)) as 0 | 1 | 2 | 3,
    })),
    data,
  };
}

async function save(
  user: KeyPairSigner,
  data: Uint8Array,
  rpcUrl: string,
  programId: Address
): Promise<string> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace("http", "ws"));

  const dataPda = await derivePDA(programId, user.address);

  const instruction = createInstruction(
    programId,
    [
      { address: user.address, role: 3 },
      { address: dataPda, role: 1 },
      { address: SYSTEM_PROGRAM_ID, role: 0 },
      { address: SYSVAR_RENT_ID, role: 0 },
    ],
    data
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => appendTransactionMessageInstruction(instruction, m),
    (m) => setTransactionMessageFeePayer(user.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  );

  const signedTransaction = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signedTransaction);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  const txWithLifetime = {
    ...signedTransaction,
    lifetimeConstraint: { lastValidBlockHeight: latestBlockhash.lastValidBlockHeight },
  } as typeof signedTransaction & { lifetimeConstraint: { lastValidBlockHeight: bigint } };

  await sendAndConfirm(txWithLifetime, {
    commitment: "confirmed",
  });

  const txInfo = await rpc.getTransaction(signature, {
    commitment: "confirmed",
    encoding: "jsonParsed",
    maxSupportedTransactionVersion: 0,
  }).send();

  if (txInfo?.meta?.logMessages) {
    for (const log of txInfo.meta.logMessages) console.log(log);
  }
  return signature as string;
}

async function load(user: KeyPairSigner, rpcUrl: string, programId: Address): Promise<Uint8Array> {
  const rpc = createSolanaRpc(rpcUrl);
  const dataPda = await derivePDA(programId, user.address);
  const accountInfo = await rpc.getAccountInfo(dataPda, {
    commitment: "confirmed",
    encoding: "base64",
  }).send();

  if (!accountInfo.value) throw new Error("Account not found");
  const [base64Data] = accountInfo.value.data as [string, string];
  return new Uint8Array(Buffer.from(base64Data, "base64"));
}

async function main() {
  const { cluster, keypair, programId, clusterFromArgs, command, commandArgs } = parseArgs();
  const rpcUrl = getClusterUrl(cluster, clusterFromArgs);

  console.log("RPC:", rpcUrl);
  console.log("Cluster:", cluster);
  console.log("Keypair:", keypair);
  console.log("Program ID:", programId);

  const user = await loadKeypairFromFile(keypair);
  console.log("User:", user.address);
  console.log();

  const progId = address(programId);

  switch (command) {
    case "save":
    case "write": {
      const message = commandArgs.join(" ") || "The quick brown fox jumps over the lazy dog";
      const sig = await save(user, new TextEncoder().encode(message), rpcUrl, progId);
      console.log("Signature:", sig);
      break;
    }
    case "load":
    case "read": {
      const data = await load(user, rpcUrl, progId);
      console.log(new TextDecoder().decode(data));
      break;
    }
    case "update": {
      const message = commandArgs.join(" ");
      if (!message) {
        console.error("Error: update requires a message");
        process.exit(1);
      }
      await save(user, new TextEncoder().encode(message), rpcUrl, progId);
      const data = await load(user, rpcUrl, progId);
      console.log(new TextDecoder().decode(data));
      break;
    }
    case "demo": {
      const msg1 = "The quick brown fox jumps over the lazy dog";
      await save(user, new TextEncoder().encode(msg1), rpcUrl, progId);
      console.log("Load:", new TextDecoder().decode(await load(user, rpcUrl, progId)));
      await save(user, new TextEncoder().encode("片云天共远, 永夜月同孤."), rpcUrl, progId);
      console.log("Load:", new TextDecoder().decode(await load(user, rpcUrl, progId)));
      break;
    }
    default:
      console.error("Missing or unknown command. Use --help for usage.");
      process.exit(1);
  }
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
