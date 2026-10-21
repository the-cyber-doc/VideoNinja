import pytest
from fastapi.testclient import TestClient
from main import app
import io


client = TestClient(app)


def test_health_check():
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_root_endpoint():
    """Test root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    assert "message" in response.json()


def test_upload_video_success():
    """Test successful video upload."""
    file_content = b"fake video content"
    files = {"file": ("test.mp4", io.BytesIO(file_content), "video/mp4")}

    response = client.post("/upload", files=files)
    assert response.status_code == 200
    assert response.json()["filename"] == "test.mp4"
    assert "status" in response.json()


def test_upload_invalid_format():
    """Test upload with invalid file format."""
    file_content = b"fake content"
    files = {"file": ("test.txt", io.BytesIO(file_content), "text/plain")}

    response = client.post("/upload", files=files)
    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"]


def test_upload_no_file():
    """Test upload without file."""
    response = client.post("/upload")
    assert response.status_code == 422
