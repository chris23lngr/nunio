# dhbw-stuttgart-mct1-datenpfad

Kurs: Mikrocomputertechnik 1

Quelle: https://dantschi.github.io/mct1/vorlesungen/05_single-cycle-datenpfad-handout.pdf
Ganzes PDF. Seiten in der Tabelle = PDF-Seiten.

Regeln: [LEITFADEN.md](LEITFADEN.md). Blind labeln, ohne Modell- oder Agentenvorschläge.

| Konzept                             | Aliase                                                                          | Seiten           | optional | nur Abbildung |
| ----------------------------------- | ------------------------------------------------------------------------------- | ---------------- | -------- | ------------- |
| Single-Cycle-Datenpfad              | Single-Cycle; Single-Cycle-Lehrmodell; Single-Cycle-Datapath; Eintakt-Datenpfad | 1–3, 20, 23, 27  |          |               |
| Mikroarchitektur                    | Microarchitecture; Mikroarchitekturen                                           | 1, 24            |          |               |
| Befehlssatzarchitektur              | ISA; Instruction Set Architecture                                               | 1                | ja       |               |
| Fünf Tätigkeiten                    | Befehlsphasen                                                                   | 3–4, 23, 27      |          |               |
| Steuersignale                       | Steuersignal; Steuerbits                                                        | 4–5, 20–21       |          |               |
| Steuerwerk                          | Steuerdecoder; Control Unit                                                     | 1, 4–5           | ja       |               |
| Zustandsübernahme an der Taktflanke | Zustandsübernahme                                                               | 2–3, 5, 9, 27    |          |               |
| Program Counter                     | PC; Befehlszähler; Programmzähler                                               | 5–6, 16–19       |          |               |
| Instruction Fetch                   | Fetch; Instruktion holen                                                        | 4–6              |          |               |
| Befehlsspeicher                     | Instruktionsspeicher; Instruction Memory                                        | 4–6, 20          |          |               |
| Datenspeicher                       | Data Memory                                                                     | 6, 12–15, 20     |          |               |
| Registerbank                        | Registerfile; Register File; Registersatz                                       | 1, 5–7, 20       |          |               |
| Befehlsfelder                       | Instruktionsfelder; Instruktionsfeld; Befehlsfeld                               | 2, 4–7, 10       |          |               |
| Registerarithmetik                  | R-Type; R-Format; R-Type-Befehl                                                 | 6–9, 25          |          |               |
| ALU                                 | Arithmetisch-logische Einheit; Arithmetic Logic Unit                            | 1, 8, 12, 20     |          |               |
| Multiplexer                         | MUX; Multiplexers                                                               | 1–2, 12, 18, 20  |          |               |
| RegWrite                            | RegWrite-Signal                                                                 | 4–5, 7–9, 20, 27 | ja       |               |
| ALUSrc                              | ALUSrc-Signal                                                                   | 4–5, 8, 12, 20   | ja       |               |
| MemtoReg                            | Memory to Register                                                              | 8, 12–13, 20     | ja       |               |
| MemRead                             | MemRead-Signal                                                                  | 12–14, 20–21     | ja       |               |
| MemWrite                            | MemWrite-Signal                                                                 | 12–14, 20–21     | ja       |               |
| PCSrc                               | PCSrc-Signal                                                                    | 18–20            | ja       |               |
| Zero-Signal                         | Zero-Flag                                                                       | 16, 18–19        | ja       |               |
| Zweierkomplement                    | Zweierkomplementwort                                                            | 10, 18           | ja       |               |
| Load-Befehl                         | lw; Load Word                                                                   | 9–15, 26         |          |               |
| Store-Befehl                        | sw; Store Word                                                                  | 9–15, 26         |          |               |
| I-Format                            | I-Type; I-Typ                                                                   | 10–11            |          |               |
| S-Format                            | S-Type; S-Typ                                                                   | 10–11            |          |               |
| Effektive Adresse                   | Basis plus Offset; Adressberechnung                                             | 2, 10, 12, 15    |          |               |
| Immediate Generator                 | ImmGen; Immediate-Generator                                                     | 11–12, 17        |          |               |
| Vorzeichenerweiterung               | Sign Extension; vorzeichenerweitert                                             | 11, 17           |          |               |
| Little Endian                       | Little-Endian                                                                   | 3, 15            |          |               |
| Byteadressierter Speicher           | Byteadressierung                                                                | 3, 15            | ja       |               |
| Branch                              | bedingter Sprung; Branch-Befehl                                                 | 1–2, 16–19, 26   |          |               |
| Sprungziel                          | Branch-Ziel; Branch target                                                      | 16–18            |          |               |
| B-Immediate                         | B-Format; B-Type                                                                | 17               |          |               |
| Taken und Fall-Through              | Taken/Fall-Through                                                              | 17–19            | ja       |               |
| Don't Care                          | Don’t Care                                                                      | 15, 20–21        |          |               |
| Kritischer Pfad                     | Critical Path                                                                   | 22–23            |          |               |
| Clock-to-Q                          | Clock-to-Q-Zeit                                                                 | 22               |          |               |
| Setup-Zeit                          | Setup; Setup-Time                                                               | 5, 22            |          |               |
| Hold-Zeit                           | Hold-Time; Hold                                                                 | 5, 22            | ja       |               |
| Taktperiode                         | Taktdauer                                                                       | 3–4, 22–23       |          |               |
| Pipeline                            | Pipelining; Pipeline-Stufen                                                     | 23               | ja       |               |
