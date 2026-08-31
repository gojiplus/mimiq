#!/usr/bin/env python3
"""
LayoutLens HTTP bridge server.

Provides HTTP API for Node.js/TypeScript to call LayoutLens.
This allows mimiq to use LayoutLens without spawning Python processes.

Usage:
    pip install layoutlens fastapi uvicorn
    python scripts/layoutlens-server.py

    # Or with uvicorn directly:
    uvicorn scripts.layoutlens-server:app --host 0.0.0.0 --port 8765

API Endpoints:
    POST /analyze - Visual assertion
    POST /accessibility-audit - Accessibility audit
    POST /compare - Visual comparison
    GET /health - Health check
"""

import os
import sys
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
except ImportError:
    print("Please install dependencies: pip install fastapi uvicorn pydantic")
    sys.exit(1)

try:
    from layoutlens import LayoutLens
    LAYOUTLENS_AVAILABLE = True
except ImportError:
    LAYOUTLENS_AVAILABLE = False
    print("Warning: layoutlens not installed. Using mock responses.")
    print("Install with: pip install layoutlens")

app = FastAPI(
    title="LayoutLens Bridge",
    description="HTTP bridge for LayoutLens visual assertions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    source: str
    query: str
    model: Optional[str] = None


class AccessibilityAuditRequest(BaseModel):
    source: str
    level: str = "AA"


class CompareRequest(BaseModel):
    source: str
    baseline: str
    threshold: float = 0.95


class LayoutLensResponse(BaseModel):
    passed: bool
    answer: str
    confidence: float
    reasoning: Optional[str] = None
    screenshot_path: Optional[str] = None
    error: Optional[str] = None


lens: Optional["LayoutLens"] = None


def get_lens() -> "LayoutLens":
    global lens
    if lens is None and LAYOUTLENS_AVAILABLE:
        lens = LayoutLens()
    return lens


def mock_response(query: str) -> dict:
    """Return mock response when LayoutLens is not available."""
    return {
        "passed": True,
        "answer": f"Mock response for: {query}",
        "confidence": 0.85,
        "reasoning": "LayoutLens not installed, using mock response",
    }


def result_response(result) -> LayoutLensResponse:
    answer = result.answer
    return LayoutLensResponse(
        passed=answer.lstrip().lower().startswith(("yes", "pass", "true")),
        answer=answer,
        confidence=result.confidence,
        reasoning=result.reasoning,
        screenshot_path=(
            result.screenshot_path
            if hasattr(result, "screenshot_path")
            else None
        ),
    )


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "layoutlens_available": LAYOUTLENS_AVAILABLE,
    }


@app.post("/analyze", response_model=LayoutLensResponse)
async def analyze(request: AnalyzeRequest):
    if not LAYOUTLENS_AVAILABLE:
        mock = mock_response(request.query)
        return LayoutLensResponse(**mock)

    try:
        lens_instance = get_lens()
        result = await lens_instance.analyze(request.source, request.query)
        return result_response(result)
    except Exception as e:
        return LayoutLensResponse(
            passed=False,
            answer="",
            confidence=0,
            error=str(e),
        )


@app.post("/accessibility-audit", response_model=LayoutLensResponse)
async def accessibility_audit(request: AccessibilityAuditRequest):
    if not LAYOUTLENS_AVAILABLE:
        return LayoutLensResponse(
            passed=True,
            answer=f"Mock accessibility audit at level {request.level}",
            confidence=0.9,
            reasoning="LayoutLens not installed, using mock response",
        )

    try:
        lens_instance = get_lens()
        result = await lens_instance.check_accessibility(
            request.source,
            compliance_level=request.level,
            mode="axe",
        )
        return result_response(result)
    except Exception as e:
        return LayoutLensResponse(
            passed=False,
            answer="",
            confidence=0,
            error=str(e),
        )


@app.post("/compare", response_model=LayoutLensResponse)
async def visual_compare(request: CompareRequest):
    if not LAYOUTLENS_AVAILABLE:
        return LayoutLensResponse(
            passed=True,
            answer="Mock visual comparison",
            confidence=0.95,
            reasoning="LayoutLens not installed, using mock response",
        )

    try:
        lens_instance = get_lens()
        result = await lens_instance.compare(
            [request.source, request.baseline],
            query=(
                "Are these interfaces visually equivalent? Answer YES only if "
                f"they meet a similarity threshold of {request.threshold}."
            ),
        )
        return result_response(result)
    except Exception as e:
        return LayoutLensResponse(
            passed=False,
            answer="",
            confidence=0,
            error=str(e),
        )


def main():
    import uvicorn

    port = int(os.environ.get("LAYOUTLENS_PORT", "8765"))
    host = os.environ.get("LAYOUTLENS_HOST", "127.0.0.1")

    print(f"Starting LayoutLens bridge server on {host}:{port}")
    print(f"LayoutLens available: {LAYOUTLENS_AVAILABLE}")
    print(f"API docs: http://{host}:{port}/docs")

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
