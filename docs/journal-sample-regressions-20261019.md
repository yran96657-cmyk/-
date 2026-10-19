# Three additional manuscript structures (2026-10-19)

This follow-up tests different source material from the two manuscripts in `journal-live-regressions-20261019.md`. Private source files, page images and PDFs remain outside the repository. Regressions in this PR use synthetic content.

## Findings and changes

| Trigger | Previous behavior | Change |
|---|---|---|
| 378 MathType `Equation.DSMT4` object occurrences | Source/imported math reported as 0/0; a generic OLE error was the only clue | Include recognized legacy equations in `sourceMath`, with separate `sourceOmmlMath`, `sourceLegacyMath`, `sourceOleObjects` and `importedLegacyMath` counters; each unsupported object gets a source address and embedded-asset hash |
| Unsupported EMF or oversized TIFF | Messages named an asset but lacked occurrence locations | Preserve the XML part/path and asset SHA-256 in bounded, validated diagnostic fields; TIFF failures include dimensions and frame count |
| DrawingML `a:moveTo` path command | Misidentified as a tracked Word revision | Only WordprocessingML revision tags trigger the revision check; real `w:moveTo` and `w:ins` still block |
| Footnote immediately followed by Latin text | `\endgroupcarrier` caused a fatal TeX error | Delimit the generated control word; regression compiles a PDF with a footnote followed by `carrier` |
| One OMML formula followed by `% (4)` | Classified as an ordinary inline paragraph | Preserve the percent suffix and the separate equation number in a display equation; prose containing a formula stays prose |
| Unicode unit exponent `mL⁻¹` | Times New Roman omitted the superscript minus | Render supported Unicode superscripts at superscript position, with a mathematical minus; original document text remains unchanged |

`inspect_journal_docx({base64})` is a read-only MCP tool using the same bounded worker as import. It returns `{importable, importReports}` even when unsupported content prevents import, without creating a project or executing OLE. `importable` only describes parser support; it does not certify publication readiness. `import_journal_docx` continues to reject incomplete input before writing. Its error now includes math/image denominators and points callers to inspection for full evidence. Error locations survive validation and round-trip storage, and the PDF report UI renders them as text.

## Actual sample results

- High-resolution raster/biochemistry manuscript: 5 OMML regions, 6 images, 1 table, 24 references and one tracked paragraph-mark insertion. Direct import still rejects two TIFFs (11100×10800 and 4252×6142) and unresolved revision markup.
- Vector-figure manuscript: 18 DrawingML image occurrences; 16 EMFs remain unsupported, 2 PNGs import. Custom note markers and legacy/grouped drawings also need attention. No complete-PDF claim is made.
- Legacy-equation manuscript: 378 legacy equation occurrences now correctly report **0/378**, with 378 per-occurrence addresses; repeated binary assets do not reduce the occurrence count. Actual OLE conversion, a field without cached text and non-image drawing support remain unresolved.

All three were rejected by the deployed importer. The 13 existing online projects were unchanged; no QA project was created by the failed imports. The online deployment has not been changed by this PR.

For the first sample only, a local engineering proof uses separately prepared, lossless PNGs for the two oversized TIFFs. This is an explicit operator preparation step with pixel equality checks, **not** a claim that the normal upload path now supports those TIFFs. Original import blockers remain attached to the candidate. The 25 MP TIFF guard and 5 MB image limit are unchanged.

Moving two figure anchors to their first citation paragraphs reduced this candidate from 13 to 12 pages without deleting prose, changing formula sizes, or resampling images. Figure 1's displayed width was set to 92% to reach at least 300 dpi with the available pixels. Substantial whitespace on page 7 remains a layout limitation. Source manuscript typos, placeholder publication fields and duplicated subfigure labels were preserved for editorial review, not silently corrected.

## Verification

- 83 native tests; 171 Web tests.
- Web and standalone builds.
- Authenticated HTTP: inspection does not create a project; import, full-document proof, 6 math objects, 29 source objects, 2 anchors, embedded fonts and stale-proof rejection pass.
- Three actual manuscripts inspected through the new runtime/MCP handler, including all 378 legacy equation locations and 16 EMF locations.
- The final local proof has 12 pages, 130/130 mapped source objects, 7 passing anchors, all fonts embedded, no compile messages and no out-of-page objects. Independent source checks preserve all 117 prose paragraphs, 12 table cells, 5 OMML trees, one note, 24 references and 6 images. The six PDF image pixel buffers also match the source; the minimum effective image resolution is 302.7 dpi.
- All 12 final pages were individually viewed at a 300 dpi rendering, following 13-page and 12-page intermediate candidates (37 page views in this follow-up). Source/editorial and whitespace findings are retained in the private audit. Automatic proof status remains `BLOCKED / productionReady=false` because persistent import/editorial blockers are not waived.

Reproduce the public checks from the repository root (Python requires `web/journal-engine/requirements.txt`, XeLaTeX and the documented fonts/packages):

```sh
python web/journal-engine/run_tests.py
cd web
node --test tests/*.test.mjs
npm run build
node standalone/build.mjs
SHUYE_FONTSET=fandol SHUYE_PYTHON=python3 node scripts/journal-http-acceptance.mjs
```

Before charging for these classes of manuscripts, the product still needs supported legacy-equation and vector-figure conversion with conservation checks, a bounded large-image preparation path, revision handling, better figure scheduling, confirmed publication metadata and independent editorial/print acceptance. This PR does not add those capabilities by relabeling blocked proofs.
