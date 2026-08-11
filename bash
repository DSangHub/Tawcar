#!/bin/bash
# deploy.sh

# Install dependencies
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx docker docker-compose

# Clone repository
git clone https://github.com/yourusername/roadie-app.git
cd roadie-app

# Setup environment
cp .env.example .env
nano .env  # Add your secrets

# Build and deploy
docker-compose up -d --build

# Setup SSL (Certbot)
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d api.roadieapp.com

# Setup PM2 for process management
npm install -g pm2
pm2 start backend/server.js --name roadie-backend
pm2 start websocket/index.js --name roadie-websocket
pm2 start ai-service/index.js --name roadie-ai
pm2 save
pm2 startup
