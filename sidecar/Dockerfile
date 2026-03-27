# Build Stage
FROM golang:1.25.7-alpine AS builder

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
FROM alpine:3.21

# Install runtime dependencies
RUN apk --no-cache add ca-certificates postgresql16-client poppler-utils

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create directories with proper ownership
RUN mkdir -p /backups && chown appuser:appgroup /backups
RUN mkdir -p /app/data && chown -R appuser:appgroup /app/data

WORKDIR /home/appuser

# Copy the binary and data files from builder
COPY --from=builder /app/sidecar .
COPY --from=builder /app/currency.json .

USER appuser

EXPOSE 8080

CMD ["./sidecar"]
