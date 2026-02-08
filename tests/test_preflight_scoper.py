import json
from pathlib import Path

from apps.backend.spec.pipeline.preflight_scoper import run_preflight_scoper


def test_preflight_scoper_runtime_bridge(tmp_path: Path) -> None:
    spec_dir = tmp_path / 'spec'
    spec_dir.mkdir()

    requirements = {
        'task_description': 'Fix intake bridge test',
        'workflow_type': 'feature',
        'intake': {
            'clarity_level': 'high',
            'suggested_title': 'Fix intake',
            'intake_model': 'glm-4.7'
        }
    }
    (spec_dir / 'requirements.json').write_text(json.dumps(requirements))
    (spec_dir / 'intake_report.md').write_text('old report')

    intake = run_preflight_scoper(
        spec_dir=spec_dir,
        project_dir=tmp_path,
        task_description=None
    )

    assert intake.get('intake_result')
    assert intake['intake_result']['clarity_level'] == 'high'
    assert (spec_dir / 'task_intake.json').exists()
    assert (spec_dir / 'intake_report.md').exists()
    assert (spec_dir / 'intake_report.v1.md').exists()
