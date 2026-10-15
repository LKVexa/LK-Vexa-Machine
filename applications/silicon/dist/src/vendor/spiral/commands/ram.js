// @ts-nocheck
/**
 * Storage and fabric commands. The four fabric nodes are images on the virtual volume
 * volume, not a RAM-only machine and not a second disk.
 */
import { fail } from "./util.js";

export const NODES = [
  { key: "small", node: "N_SMALL", role: "edge microvm" },
  { key: "medium", node: "N_MEDIUM", role: "general compute" },
  { key: "large", node: "N_LARGE", role: "memory-bound inference" },
  { key: "xlarge", node: "N_XLARGE", role: "CXL window consumer" },
];

function roster(ctx) {
  const live = ctx.host.fabricRoster ? ctx.host.fabricRoster() : [];
  return live.length ? live : NODES.map((n) => ({ ...n, present: true, built: true }));
}

function fmt(n) {
  if (!Number.isFinite(n)) return "unlimited";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(2)} MiB`;
}

async function imageOf(ctx) {
  if (!ctx.host.image) return null;
  return ctx.host.image();
}

export default [
  {
    name: "memstat",
    summary: "show the volume and page-cache ledger",
    usage: "memstat",
    async run(ctx) {
      const u = ctx.vfs.usage();
      const pct = u.maxBytes && Number.isFinite(u.maxBytes) ? Math.round((100 * u.bytes) / u.maxBytes) : 0;
      const disk = (ctx.host.disk && ctx.host.disk()) || {};
      ctx.stdout.write(
        [
          "\x1b[1mLOCAL_BROWSER ledger\x1b[0m",
          `  volume    : ${fmt(u.bytes)} / ${fmt(u.maxBytes)}  (${pct}%)`,
          `  nodes     : ${u.nodes} / ${u.maxNodes}`,
          `  store key : ${disk.device || "nvme0n1"}  (${disk.model || "IndexedDB virtual volume"})`,
          `  sync      : ${disk.synced ? "clean" : "dirty"}${disk.error ? "  " + disk.error : ""}`,
          "  cache     : worker heap; durable copy is browser-managed IndexedDB",
          "",
        ].join("\n"),
      );
      return 0;
    },
  },
  {
    name: "image",
    summary: "compare content against the factory seed (not a signature)",
    usage: "image [verify]",
    async run(ctx) {
      const info = await imageOf(ctx);
      if (!info) return fail(ctx, "image", "no image controller on this host");
      const sub = ctx.args[0] || "show";
      if (sub === "verify") {
        const ok = info.digest === info.seal;
        if (ok) {
          ctx.stdout.write(`\x1b[38;5;79mCONTENT MATCH\x1b[0m  ${info.seal}\n  runtime tree matches the boot image\n`);
          return 0;
        }
        ctx.stdout.write(
          `\x1b[33mDRIFT\x1b[0m\n  boot ${info.seal}\n  now  ${info.digest}\n  the virtual volume volume differs from the sealed factory image\n`,
        );
        return 1;
      }
      if (sub !== "show") return fail(ctx, "image", "usage: image [verify]");
      ctx.stdout.write(
        [
          "\x1b[1mboot image\x1b[0m",
          `  profile : ${info.profile}`,
          `  epoch   : ${info.epoch}`,
          `  seal    : ${info.seal}`,
          "  medium  : virtual volume nvme0n1 — poweroff flushes, it does not erase",
          "",
        ].join("\n"),
      );
      return 0;
    },
  },
  {
    name: "disk",
    summary: "show the virtual volume volume this server is mounted from",
    usage: "disk",
    async run(ctx) {
      const disk = (ctx.host.disk && ctx.host.disk()) || null;
      if (!disk) return fail(ctx, "disk", "no block device on this host");
      const when = disk.writtenAt ? new Date(disk.writtenAt).toISOString() : "never";
      ctx.stdout.write(
        [
          `\x1b[1m${disk.device}\x1b[0m  ${disk.model}`,
          `  fs      : ${disk.fs}`,
          `  mount   : ${disk.mount || "/"}`,
          `  state   : ${disk.synced ? "synced" : "dirty"}${disk.restored ? "  (remounted)" : ""}`,
          `  written : ${when}`,
          disk.error ? `  error   : ${disk.error}` : "",
          "  note    : storage may be evicted or cleared; keep exported backups",
          "",
        ]
          .filter((line) => line !== "")
          .join("\n") + "\n",
      );
      return disk.error ? 1 : 0;
    },
  },
  {
    name: "mount",
    summary: "show the only filesystem mount",
    usage: "mount",
    async run(ctx) {
      ctx.stdout.write("indexeddb:ja21-ssd/nvme0n1 on / type virtual (rw,origin-scoped)\n");
      return 0;
    },
  },
  {
    name: "cxl",
    summary: "show this server's memory window as hot and warm tiers",
    usage: "cxl [status]",
    async run(ctx) {
      const sub = ctx.args[0] || "status";
      if (sub !== "status" && sub !== "pool") return fail(ctx, "cxl", "usage: cxl [status]");
      const u = ctx.vfs.usage();
      const warm = Math.max(0, u.maxBytes - u.bytes);
      ctx.stdout.write(
        [
          "\x1b[1mmemory window\x1b[0m  \x1b[2m(admission quota for the page cache)\x1b[0m",
          `  hot  resident file bytes   ${fmt(u.bytes)}`,
          `  warm unused quota          ${fmt(warm)}`,
          "  fabric  byte-addressable load/store inside the worker heap",
          "  note    not a physical CXL device — the tier split is this quota",
          "",
        ].join("\n"),
      );
      return 0;
    },
  },
  {
    name: "df",
    summary: "fabric roster stored on the virtual volume",
    usage: "df [status|nodes|where]",
    async run(ctx) {
      const sub = ctx.args[0] || "status";
      if (sub === "where") {
        ctx.stdout.write("DF root : /df   (on nvme0n1, not a host path)\n");
        return 0;
      }
      const nodes = roster(ctx);
      if (sub === "nodes" || sub === "status") {
        ctx.stdout.write("\x1b[1mDF fabric\x1b[0m  on nvme0n1\n");
        for (const n of nodes) {
          ctx.stdout.write(
            `  ${n.present ? "\x1b[38;5;79m●\x1b[0m" : "○"} ${n.node.padEnd(10)} ${n.role}  ${n.built ? "manifest only" : "cold"}\n`,
          );
        }
        return 0;
      }
      return fail(ctx, "df", "usage: df [status|nodes|where]");
    },
  },
  {
    name: "fabric",
    summary: "render the federation on this volume",
    usage: "fabric [status|topology]",
    async run(ctx) {
      const sub = ctx.args[0] || "status";
      const nodes = roster(ctx);
      if (sub === "topology") {
        ctx.stdout.write(
          [
            "        N_SMALL ──┐",
            "        N_MEDIUM ─┼── DF0  (this host)",
            "        N_LARGE ──┤",
            "        N_XLARGE ─┘",
            "  links are names inside the worker, not network hops.",
            "",
          ].join("\n"),
        );
        return 0;
      }
      if (sub === "status") {
        const up = nodes.filter((n) => n.present && n.built).length;
        ctx.stdout.write(`fabric  ${up}/${nodes.length} node manifests resident · root /df\n`);
        return 0;
      }
      return fail(ctx, "fabric", "usage: fabric [status|topology]");
    },
  },
  {
    name: "node",
    summary: "inspect one fabric node on the volume",
    usage: "node <small|medium|large|xlarge> [status]",
    async run(ctx) {
      const key = ctx.args[0];
      const n = roster(ctx).find((x) => x.key === key || x.node.toLowerCase() === String(key || "").toLowerCase());
      if (!n) return fail(ctx, "node", "usage: node <small|medium|large|xlarge>");
      ctx.stdout.write(`${n.node}  ${n.role}\n  present : ${n.present}\n  image   : ${n.built ? "on nvme0n1" : "absent"}\n  disk    : nvme0n1\n`);
      return 0;
    },
  },
  {
    name: "link",
    summary: "show the virtual websocket this terminal is attached to",
    usage: "link",
    async run(ctx) {
      const info = (ctx.host.linkInfo && ctx.host.linkInfo()) || {};
      ctx.stdout.write(
        [
          "\x1b[1mvirtual websocket\x1b[0m",
          `  protocol : ${info.protocol || "hermit.vws.v3"}`,
          `  profile  : ${info.profile || "LOCAL_BROWSER"}`,
          `  epoch    : ${info.epoch || "—"}`,
          "  path     : worker message port (one socket per session)",
          "  frames   : 7-byte header, kind 1 input / kind 2 output, uint48 seq",
          "",
        ].join("\n"),
      );
      return 0;
    },
  },
  {
    name: "poweroff",
    summary: "flush the virtual volume and cut power",
    usage: "poweroff",
    aka: ["halt", "shutdown"],
    async run(ctx) {
      ctx.stdout.write("\x1b[33mflushing nvme0n1\x1b[0m\n");
      try {
        if (ctx.host.sync) await ctx.host.sync();
      } catch (e) {
        return fail(ctx, "poweroff", e.message || "flush failed");
      }
      ctx.stdout.write("\x1b[33mcutting power — the volume stays on the virtual volume\x1b[0m\n");
      await new Promise((r) => setTimeout(r, 40));
      if (ctx.host.poweroff) await ctx.host.poweroff();
      return 0;
    },
  },
  {
    name: "reboot",
    summary: "flush the virtual volume and remount it",
    usage: "reboot",
    async run(ctx) {
      ctx.stdout.write("\x1b[33mflushing nvme0n1 — remounting the same volume\x1b[0m\n");
      try {
        if (ctx.host.sync) await ctx.host.sync();
      } catch (e) {
        return fail(ctx, "reboot", e.message || "flush failed");
      }
      await new Promise((r) => setTimeout(r, 40));
      if (ctx.host.reboot) await ctx.host.reboot();
      return 0;
    },
  },
];
