#!/bin/bash

# Generate SSL certificates for HTTPS development
# This creates self-signed certificates that work for local development

echo "Generating SSL certificates for HTTPS development..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "mkcert not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew install mkcert
        mkcert -install
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "Please install mkcert manually: https://github.com/FiloSottile/mkcert#installation"
        exit 1
    else
        echo "Unsupported OS. Please install mkcert manually: https://github.com/FiloSottile/mkcert#installation"
        exit 1
    fi
fi

# Generate certificates
echo "Creating certificates for localhost and your IP address..."

# Get local IP address
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="127.0.0.1"
fi

echo "Using IP address: $LOCAL_IP"

# Generate certificates for localhost and IP
mkcert -key-file localhost-key.pem -cert-file localhost.pem localhost 127.0.0.1 $LOCAL_IP

echo "Certificates generated successfully!"
echo "You can now run 'npm start' to start the HTTPS development server."
echo "Access the app at: https://localhost:3000 or https://$LOCAL_IP:3000" 