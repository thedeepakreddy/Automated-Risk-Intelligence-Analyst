# Stage 1: Build the React application
FROM node:20-alpine AS frontend-build
WORKDIR /app

# Install build dependencies for native modules (like better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files and build
COPY . .
RUN npm run build

# Stage 2: Setup Python backend
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY api/ ./api/

# Copy built frontend assets from Stage 1
COPY --from=frontend-build /app/dist ./dist

# Start the FastAPI application
# Render will dynamically assign a PORT environment variable
CMD sh -c "uvicorn api.index:app --host 0.0.0.0 --port ${PORT:-8000}"
