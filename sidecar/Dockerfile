# Build Stage
FROM golang:1.26.10-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go.mod and go.sum and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o sidecar .

# Final Stage
FROM alpine:3.24

# Install runtime dependencies
RUN apk --no-cache add ca-certificates postgresql16-client poppler-utils

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create directories with proper ownership
RUN mkdir -p /backups && chown appuser:appgroup /backups
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

WORKDIR /home/appuser

# The entrypoint and the binary run while the container still holds the
# database superuser's credentials (the entrypoint asks `sidecar owner-url`
# for the owner role's URL, then execs the sidecar without the superuser's).
# They live in a root-owned directory the sidecar's user cannot write to: a
# container restart keeps the writable layer, so code running in the sidecar
# must not be able to change what the next start runs with those credentials.
# Copied without --chown on purpose.
COPY --from=builder /app/sidecar /opt/sidecar/sidecar
COPY entrypoint.sh /opt/sidecar/entrypoint.sh
RUN chmod 755 /opt/sidecar /opt/sidecar/sidecar /opt/sidecar/entrypoint.sh

# Data files the sidecar reads from its working directory
COPY --from=builder /app/currency.json .

USER appuser

EXPOSE 8080

ENTRYPOINT ["/opt/sidecar/entrypoint.sh"]
CMD ["/opt/sidecar/sidecar"]
