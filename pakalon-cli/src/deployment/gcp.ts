/**
 * Phase 5 — GCP Deployment Module
 *
 * Generates Google Cloud Run / Cloud Build deployment configs
 * for the Pakalon backend.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface GcpDeploymentOptions {
  outputDir: string;
  projectId?: string;
  region?: string;
  serviceName?: string;
  database?: "cloud-sql" | "sqlite";
  enableCloudRun?: boolean;
}

export interface GcpDeploymentResult {
  filesCreated: string[];
  serviceName: string;
  region: string;
}

const DEFAULT_REGION = "us-central1";
const DEFAULT_SERVICE = "pakalon-backend";

/**
 * Generate the full GCP deployment scaffold.
 */
export async function generateGcpDeployment(opts: GcpDeploymentOptions): Promise<GcpDeploymentResult> {
  const region = opts.region ?? DEFAULT_REGION;
  const serviceName = opts.serviceName ?? DEFAULT_SERVICE;
  const projectId = opts.projectId ?? "pakalon-project";
  const dir = path.join(opts.outputDir, "deployment", "gcp");
  const files: string[] = [];

  await fs.mkdir(dir, { recursive: true });

  if (opts.enableCloudRun !== false) {
    // cloudbuild.yaml
    await fs.writeFile(
      path.join(dir, "cloudbuild.yaml"),
      `steps:
  - name: "gcr.io/cloud-builders/docker"
    args: ["build", "-t", "gcr.io/${projectId}/${serviceName}", "."]

  - name: "gcr.io/cloud-builders/docker"
    args: ["push", "gcr.io/${projectId}/${serviceName}"]

  - name: "gcr.io/google.com/cloudsdktool/cloud-sdk"
    entrypoint: gcloud
    args:
      - run
      - deploy
      - ${serviceName}
      - --image=gcr.io/${projectId}/${serviceName}
      - --region=${region}
      - --platform=managed
      - --allow-unauthenticated
      - --memory=512Mi
      - --cpu=1
      - --concurrency=80
      - --timeout=300
      - --set-env-vars=REGION=${region}

timeout: "1800s"
`,
      "utf-8",
    );
    files.push("cloudbuild.yaml");

    // Cloud Run Dockerfile
    await fs.writeFile(
      path.join(dir, "Dockerfile"),
      `FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src/ src/
RUN bun run build

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
ENV PORT=8080
CMD ["dist/index.js"]
`,
      "utf-8",
    );
    files.push("Dockerfile");
  }

  // deploy.sh
  await fs.writeFile(
    path.join(dir, "deploy.sh"),
    `#!/usr/bin/env bash
set -euo pipefail

PROJECT="${projectId}"
REGION="${region}"
SERVICE="${serviceName}"

echo "=== GCP Deployment ==="
echo "Project: $PROJECT"
echo "Region:  $REGION"
echo "Service: $SERVICE"
echo ""

# Build and push
gcloud builds submit --config cloudbuild.yaml --project "$PROJECT"

# Deploy
gcloud run deploy "$SERVICE" \\
  --image gcr.io/"$PROJECT"/"$SERVICE" \\
  --region "$REGION" \\
  --platform managed \\
  --allow-unauthenticated \\
  --memory 512Mi \\
  --cpu 1 \\
  --concurrency 80 \\
  --timeout 300

echo ""
echo "=== Done ==="
echo "Service URL: https://$SERVICE-xxxxxxxx-xx.$REGION.run.app"
`,
    "utf-8",
  );
  files.push("deploy.sh");

  return { filesCreated: files, serviceName, region };
}