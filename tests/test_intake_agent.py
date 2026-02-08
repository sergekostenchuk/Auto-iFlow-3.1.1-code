import pytest
from unittest.mock import patch

from apps.backend.agents.intake import run_intake_analysis


class TextBlock:
    def __init__(self, text: str):
        self.text = text


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class FakeClient:
    def __init__(self, response_text: str):
        self._response_text = response_text

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def query(self, _prompt: str) -> None:
        return None

    async def receive_response(self):
        yield AssistantMessage([TextBlock(self._response_text)])


@pytest.mark.asyncio
async def test_run_intake_analysis_parses_response():
    response = '{"clarity_level": "high", "clarifying_questions": [], "suggested_title": "Title"}'
    with patch('apps.backend.agents.intake.has_iflow_auth', return_value=True), \
        patch('apps.backend.agents.intake.ensure_iflow_auth_env'), \
        patch('apps.backend.agents.intake.create_simple_client', return_value=FakeClient(response)):
        result = await run_intake_analysis(description='Test task', model='glm-4.7')

    assert result['clarity_level'] == 'high'
    assert result['suggested_title'] == 'Title'
    assert result['intake_model'] == 'glm-4.7'
