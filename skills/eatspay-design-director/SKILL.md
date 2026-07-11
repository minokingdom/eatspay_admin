---
name: eatspay-design-director
description: Analyze reference images, Pinterest moodboards, screenshots, or brand examples; extract reusable visual design grammar; match it to Eatspay style profiles; and create multiple distinct banner, popup, advertising, social, or general-image directions. Use when a user asks for similar-looking variants, brand-style learning, moodboard analysis, art direction, reference-based design exploration, or several design options rather than one generic ImageGen result.
---

# EatsPay Design Director

Turn references into a reusable style fingerprint, then create a spread of clearly different directions. Do not imitate a source pixel-for-pixel.

## Required workflow

1. Inspect every supplied image before prompting ImageGen. For a local file, use `view_image` first.
2. Extract a compact fingerprint:
   - composition and negative space
   - color roles and contrast
   - typography character and hierarchy
   - photography or illustration treatment
   - texture, depth, lighting, and geometry
   - repeated motifs and forbidden elements
3. Read [references/style-profiles.md](references/style-profiles.md) and select one primary profile plus at most one supporting profile.
4. Preserve Eatspay requirements from [references/eatspay-guardrails.md](references/eatspay-guardrails.md).
5. Produce four distinct directions unless the user specifies another count. Each direction must change at least three of: composition, visual medium, color emphasis, depth, subject scale, or typography-safe space.
6. Use the installed `imagegen` skill for bitmap generation. Issue one image-generation call per direction; do not use one call as a substitute for several distinct prompts.
7. When a reference uses expressive display lettering, treat the main Korean phrase as a first-class graphic element inside the image. Match its typographic grammar with hand lettering, dimensional type, warped baselines, outlined shapes, or decorative forms. Keep only small legal, date, or detail copy as optional editable layers.
8. Present the variants together with short labels explaining the design difference.

## Direction set

Use this default spread when the user only says “비슷하게 여러 개”:

- A — closest grammar: preserve the reference's strongest visual rules.
- B — premium editorial: more restraint, whitespace, and photographic polish.
- C — bold performance ad: stronger contrast, larger subject, faster hierarchy.
- D — friendly dimensional: softer geometry, approachable 3D or illustration cues.

Do not merely recolor the same composition.

## Style memory rule

Treat stored profiles as design memory, not model training. Update a profile only when the user explicitly approves a result as a preferred direction. Record principles, not copyrighted source files or third-party logos.

## Output contract for Design Studio

Return final generated file paths, one per line, after all variants finish. Keep every final asset inside the generated-images directory until the worker copies it into the project upload store.
