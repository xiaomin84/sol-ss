/**
 * 使用 Solana Kit 的 RPC 与集群配置，完成合约构建并部署到链上。
 * 构建：cargo build-sbf
 * 部署：solana program deploy（使用 Kit 提供的 RPC URL）
 * 
 * 支持从 .env 文件读取环境变量：
 * - RPC_URL: RPC 地址
 * - SOLANA_KEYPAIR: keypair 路径
 */

import { address } from "@solana/addresses";
import { createSolanaRpc } from "@solana/kit";
import { config } from "dotenv";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 加载 .env 文件（如果存在）
const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}
const PROGRAM_SO = path.join(ROOT, "target", "deploy", "pxsol_ss.so");

const DEFAULT_CLUSTER_URLS: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localhost: "http://localhost:8899",
};

function getClusterUrl(cluster: string, clusterFromArgs: boolean = false): string {
  // 如果命令行明确指定了 --cluster，优先使用集群的默认 URL（命令行参数优先级最高）
  if (clusterFromArgs && DEFAULT_CLUSTER_URLS[cluster]) {
    return DEFAULT_CLUSTER_URLS[cluster];
  }
  // 否则，使用环境变量 RPC_URL（如果设置了）
  if (process.env.RPC_URL) {
    return process.env.RPC_URL;
  }
  // 最后使用集群默认值
  return DEFAULT_CLUSTER_URLS[cluster] ?? DEFAULT_CLUSTER_URLS.devnet;
}

function parseArgs(): {
  cluster: string;
  keypair: string;
  programId: string | null;
  skipBuild: boolean;
  clusterFromArgs: boolean;
} {
  const args = process.argv.slice(2);
  let cluster = "devnet";
  let keypair = process.env.SOLANA_KEYPAIR ?? path.join(process.env.HOME ?? "", ".config", "solana", "id.json");
  let programId: string | null = null;
  let skipBuild = false;
  let clusterFromArgs = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cluster":
        cluster = args[++i] ?? "devnet";
        clusterFromArgs = true;
        break;
      case "--keypair":
      case "-k":
        keypair = args[++i] ?? keypair;
        break;
      case "--program-id":
        programId = args[++i] ?? null;
        break;
      case "--skip-build":
        skipBuild = true;
        break;
      case "--help":
      case "-h":
        console.log(`
用法: npm run deploy [选项]
       npx tsx scripts/deploy.ts [选项]

选项:
  --cluster <name>     mainnet-beta | devnet | testnet | localhost (默认: devnet)
  --keypair, -k <path> 部署用 keypair 路径 (默认: ~/.config/solana/id.json)
  --program-id <id>    升级已有程序时指定 program id
  --skip-build         跳过 cargo build-sbf，仅执行部署
  --help, -h           显示此帮助

环境变量（可通过 .env 文件设置）:
  RPC_URL              RPC 地址（会被 --cluster 覆盖）
  SOLANA_KEYPAIR       keypair 路径（会被 --keypair/-k 覆盖）

优先级顺序（从高到低）:
  1. 命令行参数（--keypair, --cluster 等）
  2. 环境变量（.env 文件或系统环境变量）
  3. 默认值

示例 .env 文件:
  RPC_URL=https://api.devnet.solana.com
  SOLANA_KEYPAIR=~/.config/solana/id.json
`);
        process.exit(0);
    }
  }

  return { cluster, keypair, programId, skipBuild, clusterFromArgs };
}

function run(cmd: string, args: string[], cwd: string = ROOT): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", shell: true });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

function main() {
  const { cluster, keypair, programId, skipBuild, clusterFromArgs } = parseArgs();
  const rpcUrl = getClusterUrl(cluster, clusterFromArgs);

  console.log("RPC:", rpcUrl);
  console.log("Cluster:", cluster);
  console.log("Keypair:", keypair);

  const rpc = createSolanaRpc(rpcUrl);

  if (!skipBuild) {
    console.log("\n[1/2] Building program (cargo build-sbf)...");
    const build = run("cargo", ["build-sbf"], ROOT);
    if (!build.ok) {
      console.error("Build failed:");
      console.error(build.stderr || build.stdout);
      process.exit(1);
    }
    console.log("Build OK.");
  } else {
    console.log("\n[1/2] Skip build (--skip-build).");
  }

  if (!fs.existsSync(PROGRAM_SO)) {
    console.error("Program binary not found:", PROGRAM_SO);
    process.exit(1);
  }

  console.log("\n[2/2] Deploying program...");
  const deployArgs = [
    "program",
    "deploy",
    PROGRAM_SO,
    "--url",
    rpcUrl,
    "--keypair",
    keypair,
    "--output",
    "json",
  ];
  if (programId) {
    deployArgs.push("--program-id", programId);
  }

  const deploy = run("solana", deployArgs, ROOT);
  if (!deploy.ok) {
    console.error("Deploy failed:");
    console.error(deploy.stderr || deploy.stdout);
    process.exit(1);
  }

  let programIdOut: string | null = null;
  try {
    const out = JSON.parse(deploy.stdout);
    programIdOut = out.programId ?? out.programid ?? null;
  } catch {
    const match = deploy.stdout.match(/Program Id:?\s*(\w+)/i) ?? deploy.stdout.match(/([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (match) programIdOut = match[1];
  }

  console.log("Deploy OK.");
  if (programIdOut) {
    console.log("Program Id:", programIdOut);
    const programId = programIdOut; // 保存到局部变量以确保类型缩小
    void (async () => {
      try {
        const programAddress = address(programId);
        const info = await rpc
          .getAccountInfo(programAddress, { commitment: "confirmed" })
          .send();
        if (info.value && "executable" in info.value) {
          console.log("Program account: executable =", info.value.executable);
        }
      } catch (err) {
        // 忽略验证错误，部署已成功
      }
    })();
  }
}

main();
