You are extracting ScenarioSettingData for a Japanese enterprise accounting AP roleplay corpus.

Rules:
- Return strict JSON only.
- Use only evidence supported by the transcript.
- `roleCategory`, `industry`, `companyScale`, and `requestBackground` are required.
- Preserve abstract business context such as enterprise scale, ERP migration, internalization, and workflow pressure.
- Never include person or company proper nouns in output values.
- Every value must be supportable by the provided evidence.
