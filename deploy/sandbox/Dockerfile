# Zeno execution sandbox — an isolated runner for agent terminal/code tools.
#
# Zeno's backend POSTs to /exec:
#   { "task_id": "run_x", "cmd": "ls -la" }                    (terminal)
#   { "task_id": "run_x", "code": "print(1)", "language": "python" }  (code_exec)
# and receives { stdout, stderr, exit_code }.
#
# Every request executes inside a THROWAWAY Docker container (docker run with
# --rm, no network to the host by default, CPU/memory caps, read-only FS with
# a per-task tmpfs workspace). The Zeno server itself never executes agent
# commands in its own process.

FROM node:24-alpine

# Docker CLI so the runner can spawn sibling containers.
RUN apk add --no-cache docker-cli python3 py3-pip make g++ coreutils findutils grep sed tar gzip curl git

WORKDIR /runner
COPY runner.mjs package.json ./
RUN npm init -y >/dev/null

ENV NODE_ENV=production
EXPOSE 8090
USER root
CMD ["node", "runner.mjs"]
