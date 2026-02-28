# Build Stage
FROM golang:1.25.7-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go.mod and go.sum and download dependencies
COPY go.mod go.sum* ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/worker ./cmd/worker

# Final Stage
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies (pdftotext for PDF parsing)
RUN apk add --no-cache poppler-utils ca-certificates

# Copy the compiled binary from the build stage
COPY --from=builder /bin/worker /bin/worker

# Copy currency.json file into the container (if it's still needed)
COPY currency.json .

# Create directory for schema cache
RUN mkdir -p /app/data

EXPOSE 8080

ENTRYPOINT ["/bin/worker"]
