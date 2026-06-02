# VideoNinja

A Python FastAPI application for uploading and processing videos with automated CI/CD pipeline.

## Tech Stack

- **Framework**: FastAPI (modern, fast, async-ready)
- **Web Server**: Uvicorn
- **Testing**: pytest
- **Containerization**: Docker
- **CI/CD**: GitHub Actions
- **Registry**: DockerHub

## Local Development

### Prerequisites

- Python 3.11+
- Docker & Docker Compose
- Git

### Setup Local Environment

```bash
# Clone the repository
git clone <your-repo-url>
cd videoninja

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run tests
pytest -v

# Run development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Using Docker Compose

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop
docker-compose down
```

The API will be available at `http://localhost:8000`

## API Endpoints

- `GET /health` - Health check
- `GET /` - Root endpoint with API info
- `POST /upload` - Upload a video file
  - Supported formats: .mp4, .avi, .mov, .mkv, .webm
  - Returns: filename, status, and message

### Example Upload

```bash
curl -X POST -F "file=@video.mp4" http://localhost:8000/upload
```

## CI/CD Pipeline

### How It Works

1. **On every commit to `main` or `develop`**:
   - Tests run automatically
   - Linting checks (optional)
   
2. **On successful test completion**:
   - If pushing to `main`: Docker image is built and pushed to DockerHub
   - If pulling: Only tests run

### Pipeline Stages

```
Push to GitHub → Run Tests → [if main] Build Docker → Push to DockerHub
```

## Setup Instructions

### Step 1: Initialize Git Repository

```bash
git init
git add .
git commit -m "Initial commit: video processor with CI/CD"
```

### Step 2: Create GitHub Repository

**Click-by-click:**

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `videoninja`
3. Description: `Internal video library with video uploading and processing`
4. Choose: Public (for DockerHub integration)
5. Click **Create repository**

6. Back in your terminal:
```bash
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/videoninja.git
git push -u origin main
```

### Step 3: Create DockerHub Account & Token

**Click-by-click:**

1. Go to [hub.docker.com/signup](https://hub.docker.com/signup)
2. Create account and verify email
3. Go to [Account Settings → Security](https://hub.docker.com/settings/security)
4. Click **New Access Token**
5. Name: `github-ci-token`
6. Permissions: Read & Write
7. Click **Generate**
8. **Copy the token** (you'll need it next)

### Step 4: Add GitHub Secrets

**Click-by-click:**

1. Go to your GitHub repository
2. Click **Settings** (top menu)
3. Click **Secrets and variables → Actions** (left sidebar)
4. Click **New repository secret**
5. Create two secrets:

   **Secret 1:**
   - Name: `DOCKERHUB_USERNAME`
   - Value: `your-dockerhub-username`
   - Click **Add secret**

   **Secret 2:**
   - Name: `DOCKERHUB_TOKEN`
   - Value: `paste-the-token-from-step-3`
   - Click **Add secret**

### Step 5: Push to Trigger Pipeline

```bash
git add .
git commit -m "Setup GitHub Actions CI/CD"
git push origin main
```

**Click-by-click to verify:**

1. Go to your GitHub repository
2. Click **Actions** (top menu)
3. You should see the **CI/CD Pipeline** workflow running
4. Click on it to watch the progress

### Step 6: Monitor DockerHub

After the pipeline completes successfully:

1. Go to [DockerHub](https://hub.docker.com/repositories)
2. You should see a new repository: `your-username/videoninja`
3. Click on it to view tags and image details

## Testing the Docker Image

Once pushed to DockerHub:

```bash
# Pull the latest image
docker pull YOUR-USERNAME/videoninja:main

# Run it
docker run -p 8000:8000 YOUR-USERNAME/videoninja:main

# Test it
curl http://localhost:8000/health
```

## Continuous Deployment Notes

- **main branch**: Builds and pushes to DockerHub
- **develop branch**: Only runs tests (no push)
- **Pull requests**: Only runs tests
- **Image tags**: Auto-generated from git tags and branch names

Example tags:
- `main` - latest from main branch
- `main-abc123de` - specific commit
- `v1.0.0` - semantic version (if you tag releases)

## Next Steps

1. **Add frontend**: Create `frontend/` directory with React/Vue
2. **Add processing logic**: Implement video processing in background tasks
3. **Add database**: Store processing history and results
4. **Add authentication**: Secure the upload endpoint
5. **Environment variables**: Use `.env` for configuration

## File Structure

```
.
├── main.py                    # FastAPI application
├── test_main.py              # Pytest tests
├── requirements.txt          # Python dependencies
├── Dockerfile                # Container image definition
├── docker-compose.yml        # Local development setup
├── .github/
│   └── workflows/
│       └── ci-cd.yml         # GitHub Actions workflow
├── .gitignore                # Git ignore rules
├── .dockerignore             # Docker ignore rules
└── uploads/                  # Video uploads directory
```

## Troubleshooting

**Tests failing locally but passing in CI?**
- Check Python version: `python --version`
- Reinstall dependencies: `pip install -r requirements.txt --force-reinstall`

**Docker image not pushing to DockerHub?**
- Verify secrets are set correctly in GitHub Settings
- Check DockerHub token hasn't expired
- Ensure repository is public

**Can't pull image from DockerHub?**
```bash
# May need to login
docker login
docker pull YOUR-USERNAME/videoninja:main
```

## License

MIT
