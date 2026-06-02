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

1. **On every commit to `main` or `dev`**:
   - Tests run automatically
   - Linting checks (optional)

2. **On successful test completion**:
   - If pushing to `main`: Docker image is built and pushed to DockerHub
   - If pulling: Only tests run

### Pipeline Stages

```
Push to GitHub → Run Tests → [if main] Build Docker → Push to DockerHub
```

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
├── uploads/                  # Video uploads directory
└── output/                   # Video output directory
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
