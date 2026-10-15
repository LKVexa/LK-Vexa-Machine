# LK/Vexa Machine licensing and provenance

The project license is **GNU General Public License, version 3 only**
(`GPL-3.0-only`) for the original console, integration and other material
whose copyright holders have granted those terms. `LICENSE` contains the
complete, unmodified GPL version 3 text; `COPYRIGHT` preserves the existing
project identity, **Copyright (C) 2026 RUSSELL PHILIP SMITHSON**.

This is a mixed-provenance source and research distribution. A repository
license indicator describes the project grant; it is not a grant from every
third party represented in a source archive, paper, SDK or historical tree.
Existing file-level and component notices remain applicable. No additional
restriction on use, modification or redistribution of GPL-covered material
is imposed by this document.

## Component map

| Material | Recorded terms and retained evidence |
| --- | --- |
| Console shell, native presenter/integration, tools and other owned material covered by the existing root grant | GPL-3.0-only; root `LICENSE`, `NOTICE`, `COPYRIGHT`; inherited notices retained for provenance |
| Publication documentation and integration changes | GPL-3.0-only, to the extent of the respective contributors' rights |
| Original RUSSL Zarr source, specifications and synthetic fixtures | GPL-3.0-only; `applications/silicon/corpus/russl-2.0.0/LICENSE`, `NOTICE`, `COPYRIGHT`; attribution to LKVexa and contributors |
| Previously Apache-licensed JA21 corpora and retained source | Apache-2.0 terms/notices retained; `licenses/JA21-Corpora-Apache-2.0.txt` and component notices |
| Original JA21 CPU/XPU baseline and project-authored inherited sources under `applications/silicon/` | Current GPL-3.0-only grant in root `COPYRIGHT` and `NOTICE` supersedes earlier `UNLICENSED` and no-public-distribution declarations for the copyright holder's own material; unrelated imports retain their own terms |
| HERMIT terminal/protocol lineage | Current GPL-3.0-only grant for the copyright holder's original HERMIT material supersedes its earlier reserved-rights declaration; original attribution to David Paul Russell is retained. Historical supplied notices remain provenance records. |
| Microsoft WebView2 SDK adapter 1.0.4191.47 | Microsoft package license and third-party notices retained in `licenses/Microsoft-WebView2-LICENSE.txt`, `licenses/Microsoft-WebView2-NOTICE.txt` and NuGet metadata; bundled DLLs retain those terms |
| Windows, .NET Framework/WPF, Microsoft Edge WebView2 Evergreen Runtime | Installed platform dependencies under their respective vendor terms; Evergreen browser-runtime executable is not redistributed in this package |
| Embedded source packages, research papers, historical archives and imported reference documents | Individual existing terms and author credits apply. Corpus/project licensing does not itself grant rights to independently authored contents. |
| GNU GPL license document | Copyright (C) 2007 Free Software Foundation, Inc.; reproduced verbatim |

## Current grant and historical declarations

The current publication grant applies to the copyright holder's original
console, JA21 CPU/XPU, HERMIT terminal/protocol, documentation and other
project-authored material. Earlier supplied archives and source records
contain `UNLICENSED`, reserved-rights and no-public-distribution statements.
For the copyright holder's own material, the current GPL-3.0-only grant in
`COPYRIGHT` and `NOTICE` supersedes those statements. They remain in
historical records to preserve provenance, not to impose extra conditions
on the current GPL-covered material.

This superseding grant does not apply to independently authored works of
unrelated third parties. Research articles, standards excerpts, SDKs and
embedded projects retain their own terms. Some historical corpus records
identify imported works with unresolved permissions; their presence and
citation do not themselves establish a redistribution grant. The project
GPL grant must not be described as a relicense of those works.

## Source and binary conveyance

When conveying GPL-covered object code, provide the complete Corresponding
Source as required by GPL version 3, including the build and installation
scripts needed for the covered program. Preserve the applicable copyright,
license, modification and warranty notices. A binary archive and its
matching source records should be bound by their exact version and digest;
the accompanying documentation must not imply that separately licensed or
unresolved components were relicensed by inclusion.

GPLv3 accepts compatible Apache-2.0 material in a GPLv3 work; retained
Apache notices and applicable conditions still matter. The Microsoft SDK
license supplied with this release includes a permissive redistribution
grant subject to its stated attribution, disclaimer and non-endorsement
conditions. Do not describe that supplied license as an automatic blanket
incompatibility; do not replace its text with the project GPL grant.

## Preservation

The upstream release archive and inherited files are provenance records.
Changes to root publication documentation do not rewrite historical notices
inside sealed source/reference archives. Release integrity manifests bind
the files that existed when those releases were sealed; later publication
companions should have their own digests rather than misrepresenting an
unchanged historical manifest as covering new documents.

The inherited distribution records filtering of historical log members
from `engine/df_medium/DF_Medium.source.zip` and
`helper/source/DF_Small-source.zip` in
`provenance/source-archive-filtering.json`. Retained member bytes and their
notices remain unchanged. Consult the recorded manifests for the exact
source and distribution archive identities.

## Primary references

- [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.html)
- [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html)
- [GNU license compatibility list](https://www.gnu.org/licenses/license-list.html#apache2)
- [Apache Software Foundation: Apache 2.0 and GPL compatibility](https://www.apache.org/licenses/GPL-compatibility)

These references explain the license framework; the supplied component
files are the source of the component-specific facts recorded above.
