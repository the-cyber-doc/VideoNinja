"""The encoder's checks (app/encoder/checks.py) on ffprobe's answers, faked here: every
reason to refuse or to encode, without a sample video for each (no ffmpeg needed)."""

import json

import pytest

from app.encoder import checks

MOOV = b"\x00\x00\x00\x08moov"  # an MP4 whose index comes first (faststart)
VIDEO = {
    "codec_type": "video",
    "codec_name": "hevc",
    "codec_tag_string": "hvc1",
    "profile": "Main",
    "pix_fmt": "yuv420p",
    "width": 1920,
    "height": 1080,
    "field_order": "progressive",
    "color_transfer": "bt709",
    "color_primaries": "bt709",
    "avg_frame_rate": "30/1",
}
UNTAGGED = {key: value for key, value in VIDEO.items() if key not in checks.COLORS}
AUDIO = {"codec_type": "audio", "codec_name": "aac", "profile": "LC", "channels": 2}


@pytest.fixture
def ffprobe(monkeypatch):
    """checks.run answers what the test puts in answers (one per call)."""
    answers = []
    monkeypatch.setattr(checks, "run", lambda cmd: answers.pop(0))
    return answers


@pytest.fixture
def mp4(tmp_path):
    path = tmp_path / "video.mp4"
    path.write_bytes(MOOV)
    return path


def test_upload_info_missing(tmp_path):
    with pytest.raises(checks.JobError, match="missing"):
        checks.check_complete(tmp_path / "upload", tmp_path / "upload.info")


@pytest.mark.parametrize(
    "answer, error",
    [
        ({"streams": [{"codec_type": "audio"}], "format": {"duration": "3"}}, "No video"),
        ({"streams": [{"codec_type": "video"}], "format": {}}, "Unknown duration"),
        ({"streams": [{"codec_type": "video"}], "format": {"duration": "N/A"}}, "Unknown duration"),
    ],
)
def test_duration_refused(ffprobe, mp4, answer, error):
    ffprobe.append(json.dumps(answer))
    with pytest.raises(checks.JobError, match=error):
        checks.probe_duration(mp4)


@pytest.mark.parametrize(
    "streams, error",
    [
        ([{**VIDEO, "codec_name": "h264"}], "not HEVC"),
        ([VIDEO, {**AUDIO, "codec_name": "mp3"}], "not AAC"),
    ],
)
def test_encoded_file_checked(ffprobe, mp4, streams, error):
    ffprobe.append(json.dumps({"streams": streams}))
    with pytest.raises(checks.JobError, match=error):
        checks.check_encoded(mp4)


@pytest.mark.parametrize(
    "streams, reason",
    [
        ([], "no video"),
        ([VIDEO, VIDEO], "more than one video stream"),
        ([VIDEO, AUDIO, AUDIO], "more than one audio stream"),
        ([{**VIDEO, "profile": "Main 10"}], "not hevc/hvc1 Main"),
        ([{**VIDEO, "pix_fmt": "yuv420p10le"}], "pixel format yuv420p10le"),
        ([{**VIDEO, "width": 1919}], "odd dimensions"),
        ([{**VIDEO, "field_order": "tt"}], "field order tt"),
        ([{**VIDEO, "color_transfer": "smpte2084"}], "color_transfer smpte2084, not BT.709"),
        ([{**VIDEO, "side_data_list": [{"side_data_type": "DOVI configuration record"}]}], "Dolby Vision"),
        ([VIDEO, {**AUDIO, "channels": 6}], "not AAC mono or stereo"),
    ],
)
def test_reasons_to_encode(ffprobe, mp4, streams, reason):
    ffprobe.append(json.dumps({"format": {"format_name": "mov,mp4,m4a"}, "streams": streams}))
    assert reason in checks.needs_encoding(mp4)


@pytest.mark.parametrize(
    "frames, reason",
    [
        # HDR tagged in the HEVC bitstream only: unknown on the stream, known on its frames.
        ([{"color_transfer": "arib-std-b67", "color_primaries": "bt2020"}], "color_transfer arib-std-b67, not BT.709"),
        ([{"color_primaries": "bt2020"}], "color_primaries bt2020, not BT.709"),
        ([{"color_transfer": "bt709", "color_primaries": "bt709"}], None),
        ([{}], None),  # untagged everywhere: taken as BT.709
        ([], None),  # no frame read
    ],
)
def test_colors_read_from_the_first_frame_when_unknown(ffprobe, mp4, frames, reason):
    ffprobe.append(json.dumps({"format": {"format_name": "mov,mp4,m4a"}, "streams": [UNTAGGED]}))
    ffprobe.append(json.dumps({"frames": frames}))
    if reason is None:
        ffprobe.append("0.000000,K__\n1.000000,K__\n")  # then the keyframes: fine
    result = checks.needs_encoding(mp4)
    assert result == reason if reason is None else reason in result
    assert not ffprobe  # every answer used: the frame was read


def test_frame_not_read_when_the_stream_says(ffprobe, mp4):
    ffprobe.append(json.dumps({"format": {"format_name": "mov,mp4,m4a"}, "streams": [VIDEO]}))
    ffprobe.append("0.000000,K__\n1.000000,K__\n")
    assert checks.needs_encoding(mp4) is None


def test_not_an_mp4(ffprobe, mp4):
    ffprobe.append(json.dumps({"format": {"format_name": "matroska,webm"}, "streams": [VIDEO]}))
    assert checks.needs_encoding(mp4) == "not an MP4 file"


@pytest.mark.parametrize(
    "packets, problem",
    [
        ("0.000000,K__\n1.000000,K__\n", None),
        ("0.500000,K__\n1.000000,K__\n", "does not start with a keyframe"),
        ("", "does not start with a keyframe"),
        ("0.000000,K__\n0.033333,___\n3.000000,K__\n", "keyframes up to 3.0 s apart"),
        ("N/A,K__\n0.000000,K__\n", None),
    ],
)
def test_keyframes(ffprobe, mp4, packets, problem):
    ffprobe.append(packets)
    result = checks.keyframe_problem(mp4, "30/1")
    assert result == problem if problem is None else problem in result


@pytest.mark.parametrize(
    "data, first",
    [
        (MOOV, True),
        (b"\x00\x00\x00\x08mdat", False),
        (b"\x00\x00\x00\x10ftypisom\x00\x00\x00\x00" + MOOV, True),  # after the file type box
        (b"\x00\x00\x00\x01ftyp" + (24).to_bytes(8) + b"\x00" * 8 + MOOV, True),  # a 64-bit size
        (b"\x00\x00\x00\x00free", False),  # size 0: up to the end, no index after it
        (b"\x00\x00\x00", False),  # cut in the middle of a header
        (b"", False),
        (b"\x00\x00\x00\x08free", False),  # no index at all
    ],
)
def test_moov_first(tmp_path, data, first):
    path = tmp_path / "video.mp4"
    path.write_bytes(data)
    assert checks.moov_first(path) is first


@pytest.mark.parametrize(
    "content, seconds",
    [
        (None, 0.0),  # no progress file yet
        ("frame=1\nout_time_us=2500000\nprogress=continue\n", 2.5),
        ("out_time_us=-10\n", 0.0),
        ("out_time_us=N/A\n", 0.0),
        ("frame=1\n", 0.0),
    ],
)
def test_progress_read(tmp_path, content, seconds):
    path = tmp_path / "progress"
    if content is not None:
        path.write_text(content)
    assert checks.out_time_s(path) == seconds
