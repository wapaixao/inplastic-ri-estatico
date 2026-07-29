# InPlastic — RI / Resultados Gerenciais

Site estático para apresentação de BP e DRE do Grupo InPlastic.

## Escopo atual

- BP / Balanço Patrimonial
- DRE / Resultado
- Visão por empresa e total do grupo
- Fontes e validação dos balancetes

Fora do escopo neste grupo, conforme orientação do Wagner:

- PIS/COFINS
- Lucros / Distribuição de resultado

## Estrutura

- `index.html` — layout e interação do site
- `data.json` — dados financeiros extraídos da planilha de apresentação
- `build_site.py` — gera o `data.json` a partir do workbook validável

## Fonte atual

`/root/data/clientes/grupo-inplastic/apresentacao/Grupo_Inplastic_BP_DRE_2025_PREVIA_BALANCETES.xlsx`

Aviso: prévia automática a partir de PDFs de balancete. Revisar contas críticas e eventuais eliminações intercompany antes de uso externo.
