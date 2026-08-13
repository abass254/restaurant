import type { Metadata } from "next";
import Link from "next/link";
import { readdir } from "node:fs/promises";
import path from "node:path";
import styles from "./page.module.css";

type Asset = {
  name: string;
  relativePath: string;
  publicUrl: string;
};

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".svg",
]);

export const metadata: Metadata = {
  title: "Brand Assets - DukAI",
  description: "Download DukAI image and logo assets.",
};

export const dynamic = "force-dynamic";

async function collectAssets(dir: string, rootDir: string): Promise<Asset[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const assets: Asset[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assets.push(...(await collectAssets(fullPath, rootDir)));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      continue;
    }

    const relativePath = path.relative(rootDir, fullPath);
    const encodedPath = encodeURIComponent(relativePath);
    assets.push({
      name: entry.name,
      relativePath,
      publicUrl: `/brand/download?file=${encodedPath}`,
    });
  }

  return assets;
}

export default async function BrandAssetsPage() {
  let assets: Asset[] = [];
  try {
    const projectRoot = path.resolve(process.cwd(), "..");
    const brandRoot = path.join(projectRoot, "brand");
    assets = (await collectAssets(brandRoot, brandRoot)).sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    );
  } catch {
    // Brand folder may be absent in Docker / CI builds.
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>Brand Assets</h1>
        <p>Download official DukAI posters, logos, and social creatives.</p>
        <Link href="/" className={styles.backLink}>
          Back to landing page
        </Link>
      </div>

      {assets.length === 0 ? (
        <p className={styles.empty}>No assets found in the brand folder yet.</p>
      ) : (
        <div className={styles.grid}>
          {assets.map((asset) => (
            <article key={asset.relativePath} className={styles.card}>
              <img
                src={`${asset.publicUrl}&inline=1`}
                alt={asset.name}
                className={styles.preview}
                loading="lazy"
              />
              <p className={styles.name}>{asset.name}</p>
              <p className={styles.path}>{asset.relativePath}</p>
              <a
                href={`${asset.publicUrl}&download=1`}
                className={styles.downloadBtn}
              >
                Download
              </a>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
