export namespace CICDGenerator {
  export type ProjectType = "node" | "python" | "go" | "docker"
  export type Target = "vercel" | "docker" | "aws"

  export function generateGitHubActions(projectType: ProjectType): string {
    const setup =
      projectType === "python"
        ? [
            "      - uses: actions/setup-python@v5",
            "        with:",
            "          python-version: '3.12'",
            "      - name: Install dependencies",
            "        run: pip install -r requirements.txt",
            "      - name: Lint",
            "        run: ruff check .",
            "      - name: Test",
            "        run: pytest -q",
          ].join("\n")
        : projectType === "go"
          ? [
              "      - uses: actions/setup-go@v5",
              "        with:",
              "          go-version: '1.23'",
              "      - name: Test",
              "        run: go test ./...",
              "      - name: Build",
              "        run: go build ./...",
            ].join("\n")
          : projectType === "docker"
            ? [
                "      - name: Build image",
                "        run: docker build -t app:ci .",
                "      - name: Smoke test image",
                "        run: docker run --rm app:ci --help || true",
              ].join("\n")
            : [
                "      - uses: actions/setup-node@v4",
                "        with:",
                "          node-version: '20'",
                "          cache: 'npm'",
                "      - name: Install dependencies",
                "        run: npm ci",
                "      - name: Lint",
                "        run: npm run lint --if-present",
                "      - name: Test",
                "        run: npm test --if-present",
                "      - name: Build",
                "        run: npm run build --if-present",
              ].join("\n")

    return [
      "name: CI",
      "",
      "on:",
      "  push:",
      "    branches: [main, dev]",
      "  pull_request:",
      "    branches: [main, dev]",
      "",
      "jobs:",
      "  ci:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      setup,
    ].join("\n")
  }

  export function generateDeployWorkflow(target: Target): string {
    const deploy =
      target === "vercel"
        ? [
            "      - name: Deploy to Vercel",
            "        run: npx vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }}",
          ].join("\n")
        : target === "docker"
          ? [
              "      - name: Login to registry",
              "        run: echo \"${{ secrets.DOCKER_PASSWORD }}\" | docker login -u \"${{ secrets.DOCKER_USERNAME }}\" --password-stdin",
              "      - name: Build and push",
              "        run: docker build -t ${{ secrets.DOCKER_USERNAME }}/app:${{ github.sha }} . && docker push ${{ secrets.DOCKER_USERNAME }}/app:${{ github.sha }}",
            ].join("\n")
          : [
              "      - name: Configure AWS credentials",
              "        uses: aws-actions/configure-aws-credentials@v4",
              "        with:",
              "          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}",
              "          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}",
              "          aws-region: ${{ secrets.AWS_REGION }}",
              "      - name: Deploy",
              "        run: aws ecs update-service --cluster ${{ secrets.AWS_ECS_CLUSTER }} --service ${{ secrets.AWS_ECS_SERVICE }} --force-new-deployment",
            ].join("\n")

    return [
      "name: Deploy",
      "",
      "on:",
      "  workflow_dispatch:",
      "  push:",
      "    branches: [main]",
      "",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      deploy,
    ].join("\n")
  }

  export function generateDependabot(): string {
    return [
      "version: 2",
      "updates:",
      "  - package-ecosystem: 'npm'",
      "    directory: '/'",
      "    schedule:",
      "      interval: 'weekly'",
      "  - package-ecosystem: 'docker'",
      "    directory: '/'",
      "    schedule:",
      "      interval: 'weekly'",
      "  - package-ecosystem: 'github-actions'",
      "    directory: '/'",
      "    schedule:",
      "      interval: 'weekly'",
    ].join("\n")
  }

  export function generateDockerfile(projectType: ProjectType): string {
    if (projectType === "python") {
      return [
        "FROM python:3.12-slim",
        "WORKDIR /app",
        "COPY requirements.txt .",
        "RUN pip install --no-cache-dir -r requirements.txt",
        "COPY . .",
        "CMD [\"python\", \"main.py\"]",
      ].join("\n")
    }
    if (projectType === "go") {
      return [
        "FROM golang:1.23-alpine AS build",
        "WORKDIR /src",
        "COPY . .",
        "RUN go build -o app .",
        "",
        "FROM alpine:3.21",
        "WORKDIR /app",
        "COPY --from=build /src/app ./app",
        "CMD [\"./app\"]",
      ].join("\n")
    }
    if (projectType === "docker") {
      return [
        "FROM alpine:3.21",
        "WORKDIR /app",
        "COPY . .",
        "CMD [\"sh\", \"-c\", \"echo ready && sleep 3600\"]",
      ].join("\n")
    }
    return [
      "FROM node:20-alpine",
      "WORKDIR /app",
      "COPY package*.json ./",
      "RUN npm ci",
      "COPY . .",
      "RUN npm run build --if-present",
      "CMD [\"npm\", \"run\", \"start\"]",
    ].join("\n")
  }

  export function generateDockerCompose(services: string[]): string {
    const body = services
      .map((x) =>
        [
          `  ${x}:`,
          "    build: .",
          "    restart: unless-stopped",
          "    ports:",
          "      - '3000:3000'",
        ].join("\n"),
      )
      .join("\n")
    return ["version: '3.9'", "services:", body || "  app:\n    build: ."].join("\n")
  }

  export function generateDeployScript(target: Target): string {
    const run =
      target === "vercel"
        ? "npx vercel deploy --prod"
        : target === "docker"
          ? "docker compose up -d --build"
          : "aws ecs update-service --cluster \"$AWS_ECS_CLUSTER\" --service \"$AWS_ECS_SERVICE\" --force-new-deployment"

    return [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "echo \"Starting deploy...\"",
      run,
      "echo \"Deploy done\"",
    ].join("\n")
  }
}
