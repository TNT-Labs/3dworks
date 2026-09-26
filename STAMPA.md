# Tenuta ai liquidi e stampa 3D

Un vaso stampato in FDM non è un vaso: è una pila di anelli incollati. Tiene il
liquido solo se ogni anello è abbastanza largo da contenere un numero intero di
passate di estrusione e se ogni passata si è saldata a quella sotto. La
geometria può fare metà del lavoro — questa la fa — l'altra metà la fanno le
impostazioni di stampa.

Questo documento riporta cosa ho misurato sulla geometria prodotta e come
stampare i pezzi perché tengano davvero.

---

## Il verdetto

| Elemento | Esito | Numero |
|---|---|---|
| Mesh esportata | **chiusa** in tutti i casi provati, anche agli estremi dei cursori | 0 bordi aperti, 0 spigoli non-manifold, volume coerente allo 0,2 % |
| Fondo sotto l'incisione | **tiene con margine** | ≥ 1,8 mm pieni nel caso peggiore (incisione 1,2 mm su fondo 3,0 mm) |
| Parete del corpo | **tiene**, ed è quella impostata *misurata perpendicolarmente* | 2,0–8,0 mm, 100 % del nominale su tutta la corsa dei cursori |
| Fascia di spalla | **tiene**, dopo la correzione della geometria | 2,00–3,20 mm, esattamente la parete impostata (era 0,90 mm) |
| Collo filettato | **tiene** | parete 3,0 mm costanti, battuta di tenuta piana larga 3,0 mm |
| Inclinazione massima | entro i 45° sui preset | 36–42°, lo studio segnala in rosso oltre 45° |

**In una riga:** i pezzi sono a tenuta su tutta la corsa dei cursori. La parete
misurata è ovunque quella impostata, cioè almeno cinque passate di estrusione.

> **Questa pagina ha già sbagliato una volta, e vale la pena sapere come.**
> Fino alla revisione della cavità, «parete misurata» voleva dire *spessore
> radiale*: la differenza fra il raggio esterno e quello della cavità. Su un
> cilindro è la stessa cosa; su un vaso a costole no, perché sul fianco di una
> costola la normale alla superficie non è radiale. Lo spessore vero dei preset
> era **1,46–1,67 mm** con 2,40 richiesti — tutti sotto la soglia di tenuta —
> e la pagina dichiarava 2,40 perché misurava il raggio. Vedi «La parete vera».
> Ora la cavità è costruita in modo che la misura perpendicolare torni, e lo
> strumento riporta entrambe.

Tutti e quattro i preset di listino passano. Non era così: la prima misura
(vedi sotto) aveva trovato la fascia di spalla a 0,90 mm su metà dello spazio
dei parametri, e **Tempesta** e **Fiamma** erano fra i design difettosi. La
geometria è stata corretta e `node scripts/tenuta.js` lo riverifica a ogni
esecuzione, affilatura per affilatura.

---

## Come verificare un design

```bash
node scripts/tenuta.js                       # i quattro preset
node scripts/tenuta.js "v=1&h=185&r=62&…"    # un design: la parte dopo il # del link
node scripts/tenuta.js --larghezza 0.45      # con un'altra larghezza di estrusione
```

Lo strumento costruisce **la stessa mesh dell'export** e misura gli spessori
riga per riga. Non stima nulla: legge i vertici, e misura la distanza
**perpendicolare** fra i due contorni di ogni strato — non più la differenza
di raggio. Riporta tutte e due, così la differenza resta visibile.

Legge la parete in *passate di estrusione*, che è ciò che decide la tenuta:

- **meno di 2** — non ci stanno un perimetro esterno e uno interno: il slicer ci
  mette un filo solo, o rinuncia. Il liquido passa.
- **2–3** — due perimetri che si toccano, nessun margine: una sola passata
  sotto-estrusa apre una via.
- **3 o più** — c'è un perimetro di mezzo che fa da tappo anche se gli altri due
  hanno un difetto. È la condizione da cercare.

---

## La catena di tenuta, misurata

### Il fondo — il pezzo più robusto

Il pavimento della cavità sta a **3,0–3,9 mm** dal piano con le pareti fino a
3 mm (la prima riga della mesh oltre i 3 mm; cresce con l'altezza del pezzo), e
**segue la parete** quando questa sale: 6,2 mm con una parete da 6, fino a
8,5 mm con una da 8. L'incisione arriva al massimo a **1,2 mm**, quindi sotto il
liquido restano sempre **almeno 1,8 mm** di materiale pieno — nove strati. Lo
studio lo mostra come «≥ x mm pieni» ed è un vincolo di costruzione, non una
raccomandazione: i cursori non permettono di violarlo.

Dal fondo pieno nella ricetta (`bottom_solid_min_thickness`, 4 mm o quanto serve
al fondo di quel design) quei millimetri sono anche **stampati** pieni, non solo
geometricamente: prima ne venivano solidi 2,0 e in mezzo restava reticolo al
6 %, col vero sbarramento affidato a 1 mm di strati pieni stesi sopra il vuoto.

L'incisione, poi, non è una cava a fondo piatto ma una **conca a sezione
parabolica larga 1,5 mm**: ogni strato chiude un po' più del precedente e
l'ultimo attraversa sei decimi di millimetro. Nessun ponte, nessuna superficie
sospesa. È il tipo di incisione che si stampa bene.

### La parete vera — il difetto che ha resistito a due tentativi

Un pezzo stampato continuava a bucarsi al tatto anche con la parete portata a
8 mm. Non era lo spessore: era **la misura**.

Lo spessore di un guscio è la distanza fra le sue due facce misurata
**perpendicolarmente**. La cavità, invece, era la faccia esterna spostata di
2,4 mm *lungo il raggio*. Su un cilindro le due cose coincidono. Su un vaso a
costole no: sul fianco di una costola la normale alla superficie non è radiale,
e uno spostamento radiale di 2,4 mm lascia uno spessore vero di 2,4·cos α, con
α l'angolo fra raggio e normale.

Quanto vale α lo decide la geometria delle costole, non la parete. Misurato
sulla mesh esportata, con 2,40 mm richiesti:

| costole | affilatura 0 | 0,36 | 0,70 | 1,00 |
|---|---|---|---|---|
| 3 | 2,40 | 2,13 | 1,51 | 0,98 |
| 6 | 2,40 | **1,67** | 0,90 | 0,51 |
| 9 | 2,40 | 1,30 | 0,62 | **0,34** |

I quattro preset di listino stavano fra **1,46 e 1,67 mm**: tutti sotto la
soglia di tenuta di 1,8, mentre la scheda dichiarava 2,40. Ai minimi dei
cursori si arrivava a **0,43 mm** con 3,2 dichiarati: carta velina. E siccome la resa è
una *frazione* della geometria e non un valore assoluto, ingrossare la parete
non poteva funzionare: 8 mm dichiarati con nove costole affilate restavano
**1,08 mm** veri.

**La cavità ora è il corpo eroso da una sfera del raggio della parete** —
l'insieme dei punti in cui quella sfera ci sta tutta. Per definizione ogni
punto della superficie esterna ha almeno *w* di materiale sotto di sé, misurato
perpendicolarmente. Il conto è esatto: per ogni direzione si cerca il raggio
massimo a cui il disco non tocca nessun segmento del contorno dello strato, e
il contorno dello strato è esattamente il poligono che finisce nell'STL.

Su 3888 design provati agli estremi dei cursori nessuna mesh si rompe, e
l'inclinazione non peggiora: i design che superano i 45° erano gli stessi
prima (126 su 288 nel campione, contro 122 adesso), e lo superano sulla faccia
esterna, non nella cavità.

Dove le costole sono più fitte della sfera, la sfera non entra e **la costola
resta piena**: smette di essere una piega sottile del guscio e diventa un nervo
di rinforzo, che è il modo in cui si irrigidisce un recipiente a parete
sottile. Ogni casella della tabella qui sopra vale ora **2,40 mm**.

Il conto si paga in capacità e materiale — è il materiale che prima mancava:

| preset | capacità | filamento | tempo |
|---|---|---|---|
| Aureo | 903 → **876 ml** | 183 → **217 g** | 18,5 → **21,9 h** |
| Maelström | 762 → **732 ml** | 154 → **188 g** | 15,8 → **19,6 h** |
| Fiamma | 1092 → **1054 ml** | 211 → **249 g** | 22,4 → **26,7 h** |
| Marea | 701 → **673 ml** | 134 → **162 g** | 13,9 → **17,0 h** |

La **faccia esterna non cambia di un micron** — verificato confrontando
1.064.448 coordinate con il motore precedente, zero differenze: il pezzo ha lo
stesso aspetto, cambia solo ciò che ha dentro. La cavità è anche limitata a 44° come la faccia
esterna, con la stessa regola e nella direzione che non assottiglia mai la
parete: senza quel limite, sui design molto affilati il cielo della cavità
arrivava a 58° e avrebbe voluto i supporti.

### La parete spessa — e la trappola dei perimetri fissi

Il cursore arriva a **8 mm**. Serve a un pezzo che si deve poter stringere in
mano: un vaso alto con 2,4 mm di PLA è a tenuta ma flette, e su un primo strato
sottoestruso o su uno spigolo si buca. Con 4–5 mm il pezzo diventa rigido.

Ingrossare la parete però **non basta**, e se si sbaglia il seguito si ottiene
l'opposto. La parete di un vaso ha due contorni — la faccia esterna e quella
della cavità — quindi ogni perimetro della ricetta vale **due passate**, una per
lato. Con i 4 perimetri fissi di prima si coprono 3,2 mm; il resto di una parete
da 6 mm non sarebbe guscio pieno ma **gyroid al 6 % chiuso dentro la parete**:
più spessa, più pesante, più lenta — e più fragile di una da 2,4, perché una
scatola vuota cede alla prima pressione e il liquido corre lungo il reticolo.

Per questo il numero di perimetri nel 3MF ora lo scrive l'export a partire dal
design: `perimetri = max(4, ⌈parete / 0,8⌉)`. Una parete da 6 mm esce con 8
perimetri, una da 8 mm con 10. Se slicci l'**STL** invece del 3MF questa
impostazione non viaggia con il file: alzala a mano, o il guscio spesso resta
vuoto dentro.

Il **fondo** segue la parete per la stessa ragione (minimo 3 mm come prima,
tetto a un quinto dell'altezza), e `bottom_solid_min_thickness` lo segue a sua
volta: un guscio da 6 mm su un pavimento da 3 mm avrebbe il punto debole proprio
dove il liquido preme e dove il vaso appoggia.

Cosa costa, su un Aureo (185 × Ø124):

| parete | capacità | materiale | filamento | tempo | perimetri nel 3MF |
|---|---|---|---|---|---|
| 2,4 mm | 903 ml | 148 cm³ | 183 g | ≈18 h | 4 |
| 4,0 mm | 823 ml | 228 cm³ | 283 g | ≈29 h | 5 |
| 6,0 mm | 729 ml | 323 cm³ | 400 g | ≈40 h | 8 |
| 8,0 mm | 639 ml | 412 cm³ | 511 g | ≈52 h | 10 |

Il collo non segue lo slider oltre i ~3 mm: lì comanda la norma GPI e
l'alesaggio non può stringersi oltre Ø12. Su una parete spessa **il collo resta
quindi il punto più sottile del pezzo**, ed è quello che la scheda riporta come
«parete reale».

Su un pezzo piccolo — il portaspazzolino ai minimi dei cursori — una parete da
6–8 mm non ci sta: la cavità si richiude e del guscio resta la scaglia del fondo
scala. Lo studio lo dice («la parete da 8,0 mm non entra nel pezzo») e l'export
si rifiuta di produrre il file.

### La fascia di spalla — il difetto che c'era

Era il punto debole del pezzo, ed è anche quello che si sentiva in mano:
avvitando la pompa, il vaso cedeva proprio lì.

Nel raccordo verso il collo le due superfici smettevano di essere parallele — la
esterna si piega verso il collo, l'interna verso il foro — e **ciascuna veniva
limitata per conto suo** dal vincolo dei 44°. In più le costole avevano ampiezza
diversa dentro e fuori, così le due onde si disallineavano e lo spessore
oscillava attorno alla circonferenza, formando una striscia sottile per costola.
La parete si chiudeva fino al minimo strutturale di 0,90 mm.

Spessore minimo reale della parete, in millimetri, **prima della correzione**:

| parete impostata | affilatura 0 | 0,25 | 0,36 | 0,50 | 0,75 | 1,00 |
|---|---|---|---|---|---|---|
| 2,0 | 2,00 | 1,42 | 0,99 | **0,90** | **0,90** | **0,90** |
| 2,4 | 2,40 | 1,69 | 1,26 | **0,90** | **0,90** | **0,90** |
| 2,8 | 2,80 | 1,95 | 1,51 | **0,90** | **0,90** | **0,90** |
| 3,2 | 3,00 | 2,19 | 1,75 | 1,16 | **0,90** | **0,90** |

**Dopo la correzione ogni casella di quella tabella vale la parete impostata**
(e 3,00 nella riga da 3,2, perché lì comanda il collo a norma GPI). La cavità
non è più una seconda superficie vincolata per conto suo: è la faccia esterna
meno lo spessore voluto, e le costole hanno la stessa ampiezza sui due lati. La
faccia esterna non è cambiata di un micron su nessuno dei 3888 design provati.

Lo si riverifica senza fidarsi di questa pagina:

```bash
node scripts/tenuta.js          # i preset, più una scansione dell'affilatura
```

Il segnale personale (GPX o voce) non peggiora la situazione, e ora non può
peggiorarla per costruzione: qualunque forma prenda la faccia esterna, la
cavità è quella faccia erosa dello spessore voluto. Prima toglieva 0,06 mm al
minimo — misurato sulla parete radiale, che era comunque il numero sbagliato.

### Il collo — tiene

Parete **3,0 mm** costanti (fondo filetto Ø25,7 contro foro Ø19,7 sul 28/410),
e in cima una **battuta piana larga 3,0 mm** su cui appoggia la guarnizione
della pompa: gli ultimi 2,4 mm di collo sono lisci, il filetto è già sfumato.
È la geometria giusta per una tenuta a compressione.

Il filetto è un cordolo elicoidale a sezione arrotondata, non il profilo GPI
esatto: le quote di listino (T = 28,2 su un nominale di 28) portano già
l'abbondanza tipica della stampa. **Il verdetto è lo spool di prova**, il
bottone nella sezione «Collo» dello studio: dieci minuti di stampa e ci avviti
sopra la pompa vera.

---

## Impostazioni di stampa

### Materiale

| | Tenuta | Note |
|---|---|---|
| **PETG** | **la scelta** | Strati che si saldano bene, resiste all'acqua e ai tensioattivi dei saponi. Poco fragile: un pezzo che flette non delamina. |
| PLA | no per liquidi | Si stampa meglio di tutti ed è il peggiore qui: fragile fra gli strati e soggetto a idrolisi. Va bene per il portaspazzolino. |
| ASA / ABS | buona, ma | Regge oli essenziali e alcol, ma su una stampante aperta ritira e delamina: il modo più facile di ottenere un pezzo che trasuda. |
| PP | ottima chimicamente | Praticamente immune a tutto, praticamente impossibile da far aderire al piatto. Solo se sai già come si fa. |

**Nessuno di questi pezzi è idoneo al contatto alimentare.** Le righe di strato
trattengono residui che non si lavano via, e un ugello in ottone può cedere
tracce di piombo. Sapone, detersivo, shampoo: sì. Olio da cucina, acqua da
bere: no, non senza una barriera interna certificata.

### Slicer

I valori che decidono la tenuta, in ordine di importanza.

| Impostazione | Valore | Perché |
|---|---|---|
| **Generatore di perimetri** *(già nel 3MF)* | **Arachne** | È il parametro che conta più di ogni altro. Adatta la larghezza delle singole passate allo spessore che trova, senza lasciare avanzi. Serviva soprattutto a salvare la vecchia fascia di spalla da 0,90–1,26 mm; ora che la parete è ovunque quella impostata resta comunque la scelta migliore. PrusaSlicer 2.6+ e OrcaSlicer ce l'hanno di serie. |
| **Larghezza di estrusione** *(già nel 3MF)* | **0,40 mm** | Divide esattamente le pareti «tonde» (2,0 · 2,4 · 2,8 · 3,2 · 4,0 · 4,8 · 5,6 · 6,4 · 7,2 · 8,0): lì i perimetri riempiono senza avanzi. Il cursore si muove di 0,1 mm, quindi le misure intermedie un avanzo ce l'hanno — è esattamente ciò che Arachne assorbe allargando le passate, e il numero di perimetri è arrotondato per eccesso perché l'avanzo resti dentro i cordoli e non diventi riempimento. A 0,45 — il default di PrusaSlicer per un ugello da 0,4 — una parete da 2,4 mm lascia 0,15 mm di fessura che corre per tutta l'altezza del pezzo. |
| **Perimetri** *(già nel 3MF)* | **4 o più, li scrive lo studio** | Quattro per lato coprono 3,2 mm: bastavano finché la parete massima era 3,2. Il numero lo calcola ora l'export (`recipeFor`) su **due** misure del design — la parete, che arriva a 8 mm, e lo spessore massimo locale, perché con la cavità erosa le costole affilate restano piene e il loro nucleo va riempito di cordoli e non di reticolo. Sui preset vengono 6–7 perimetri invece di 4. Il tetto è 16: oltre, il nucleo resta riempimento (è il caso delle costole da venti millimetri, dove riempirle di soli cordoli costerebbe ore) e il materiale dichiarato diventa un limite superiore. Sotto i 4 si perde comunque il perimetro centrale di sicurezza. |
| **Ventola** *(ora nel 3MF)* | **max 30 %, spenta sui primi 5 strati** | Sul PETG è la prima causa di perdite: raffredda la passata prima che si saldi a quella sotto e il pezzo trasuda lungo le righe di strato. Ed è anche la prima causa di pezzi **fragili**: una passata raffreddata non fonde con quella sopra, resta incollata. |
| **Temperatura ugello** *(ora nel 3MF)* | **240 °C** (245 il primo strato) | Più caldo salda meglio. Se compaiono fili, si tolgono dopo; una delaminazione non si toglie. |
| **Fondo pieno** *(già nel 3MF)* | `bottom_solid_min_thickness = 4` | Sostituisce sia i «6 / 6 strati pieni» sia l'aumento del riempimento: il pavimento viene pieno per tutti i suoi 3–4 mm, quindi sotto il liquido non resta reticolo. Costa +9–14 % di materiale. Di conseguenza il pezzo non ha più alcuna zona a riempimento rado e il valore del gyroid è ininfluente. |
| **Cucitura (Z-seam)** *(nel 3MF: `random`)* | **a becco di flauto** (*scarf joint*) dove c'è; altrimenti vedi la nota qui sotto | La cucitura è la fila di partenze e arresti dei perimetri: è lì che si formano i micro-fori. Sul *scarf joint* non c'è discussione — rampa l'estrusione e il difetto non si forma proprio: se il tuo slicer ce l'ha, usalo. Su cosa fare quando non c'è, questo documento e la ricetta incorporata **non concordano**: vedi «Cucitura: una scelta aperta». |
| **Strato** | 0,20 mm, primo 0,24 mm | Più fine non aiuta la tenuta e raddoppia il tempo. |
| **Compensazione zampa d'elefante** | 0,15 mm | Senza, la base svasa e il codice inciso si chiude. |
| **Stiratura** *(ironing)* | attiva sulle superfici superiori | Le uniche superfici superiori sono la battuta del collo e il pavimento della cavità: lisciarle costa pochi secondi e la guarnizione della pompa appoggia su una superficie piana invece che su righe. |
| **Supporti** | **nessuno** | Il motore vincola tutte le pareti a 44°. Se lo studio segnala più di 45°, cambia il design: i supporti dentro la cavità non si tolgono. |
| **Brim** | 0, ma **8 mm sui pezzi alti e stretti** | Un tornado da 235 mm su una base da Ø60 si stacca. |
| **Calibrazione del flusso** | obbligatoria | Un flusso al 95 % lascia fra le passate fessure che nessuna impostazione compensa. Vale la mezz'ora del test a parete singola. |

La ricetta incorporata nei file **3MF** esportati dallo studio (`Slic3r_PE.config`
e `project_settings.config`) porta strato, perimetri, strati pieni, riempimento,
assenza di supporti e — da questa revisione — **temperatura, piano e ventola**,
per il materiale scelto nello studio. Erano le due impostazioni che decidono la
saldatura fra strati, e prima non viaggiavano affatto: chi apriva il file si
ritrovava il proprio profilo filamento di serie, tipicamente 210 °C con la
ventola al 100 %, che è la ricetta esatta di un pezzo di cristallo.

Attenzione a una cosa: PrusaSlicer e Orca possono tenere il *tuo* profilo
filamento invece di quello del file. Dopo l'apertura **controlla che i gradi
siano quelli**. Larghezza di estrusione e generatore di perimetri restano
dipendenti dalla macchina.

### Se il pezzo si rompe come il vetro

Non è lo spessore. Un pezzo fragile a flessione, con la frattura piatta e
lucida su una riga di strato, è **mal saldato**: fra uno strato e il successivo
il polimero non ha rifuso. Raddoppiare la parete raddoppia la sezione di una
saldatura che non c'è, e infatti non serve a niente.

Il **provino di robustezza** dello studio separa le due cause in venti minuti,
cambiando una sola variabile — l'orientamento. Sono due barrette identiche,
dello spessore della tua parete e con la tua stessa ricetta: una in piedi
(strati *perpendicolari* alla flessione: misura la saldatura) e una coricata
(strati *paralleli*: misura il materiale). Si piegano fra le dita:

| cosa vedi | cosa è | cosa fai |
|---|---|---|
| coricata flette, **eretta si spezza di netto**, frattura piatta e lucida | saldatura fra strati | +10–15 °C, ventola giù, asciuga il filo. Nessuna modifica al disegno lo risolve |
| **si spezzano entrambe** di netto | materiale | bobina umida o vecchia: asciugala 4 h a 55–65 °C, o cambiala |
| **flettono entrambe** e sbiancano | la stampa è sana | la fragilità del pezzo grosso è altrove: spessore, urto, aggressione chimica |

Venti minuti e 4 g, contro le venti ore del pezzo intero. Va stampato **prima**
di rifare il pezzo grosso, non dopo.

#### Cucitura: una scelta aperta

Due analisi indipendenti di questo repository sono arrivate a conclusioni
opposte, e vale la pena che resti scritto invece di sparire in un merge.

**Per l'allineata.** La cucitura è un difetto: concentrarlo in una riga sola
lascia pulito tutto il resto del pezzo, e quella riga si può nascondere in un
solco fra due costole. Sparpagliarlo significa averne uno ovunque.

**Per la casuale.** Allineare significa impilare le interruzioni sulla stessa
verticale: se l'estrusione parte male in modo sistematico — filamento umido,
ritrazione tarata larga, un ugello che cola — quel difetto diventa un canale
continuo dal fondo al collo. Sparpagliandolo, ogni difetto è coperto dallo
strato sopra e sotto.

**Cosa si può dire con certezza.** Con la parete fatta di cinque o sei passate
e le cuciture dei perimetri interni sfalsate (`staggered_inner_seams`), nessuna
delle due crea un passaggio che attraversi la parete: servirebbe che la fessura
bucasse tutte le passate nello stesso punto. La differenza riguarda il margine
contro l'imprevisto, non un difetto dimostrato.

La ricetta incorporata usa `random` perché sbaglia in modo più innocuo: un
problema sistematico resta sparso invece di diventare una riga. Se preferisci
l'aspetto pulito dell'allineata, cambiala nello slicer — la geometria non ne
risente. Il modo di chiudere la questione è una prova con acqua in pressione
(sotto) su due pezzi identici, uno per scelta.

---

### Elegoo Neptune 3 Pro

È la macchina per cui i pezzi sono dimensionati (220 × 220 × 250 mm nel
software). Estrusore diretto, quindi il PETG le riesce bene. Due accortezze:
sul lamierino PEI il PETG aderisce **troppo** e può strappare il rivestimento —
un velo di colla stick come distaccante — e il piatto va a 80 °C, non ai 60 del
PLA.

---

## La prova di tenuta

Una stampa che sembra perfetta può trasudare. Si verifica così, in quest'ordine:

0. **Provino di robustezza** — dal pannello «Ricetta» dello studio. Venti
   minuti, e dice se la macchina salda gli strati. Se non li salda, tutto il
   resto è inutile: vedi «Se il pezzo si rompe come il vetro».
1. **Spool di prova** — dal pannello «Collo» dello studio. Dieci minuti. Ci
   avviti sopra la pompa vera: se avvita stretto, scendi di 0,2–0,3 mm sul Ø T
   nella modalità «Personali» e riprova. Fallo *prima* di stampare il pezzo
   intero, che sono ore.
2. **Acqua ferma, 24 ore.** Riempi d'acqua tiepida, appoggia su un foglio di
   carta asciutta, lascia un giorno. Il foglio è il testimone.
3. **Prova in pressione.** Asciuga l'esterno, avvolgi il pezzo in un tovagliolo
   e stringi: quasi tutte le microfessure trasudano solo sotto pressione, e la
   pompa fa esattamente questo ogni volta che la premi.
4. **Venti pompate.** Con la pompa avvitata: sollecita la battuta di tenuta, che
   è l'altro punto in cui un dispenser perde.

**Se trasuda, guarda dove.** A metà altezza, in una fascia orizzontale sotto la
spalla, è la parete: rialza la parete e abbassa l'affilatura sotto 0,4. Dal
fondo è il primo strato o il flusso. Dal collo è la battuta: attiva la stiratura
o passa un foglio di carta abrasiva fine sulla sommità.

---

## Cosa non ho verificato

Onestà sul perimetro di questa analisi:

- **Non ho stampato niente.** Tutto quanto sopra viene dalla misura della
  geometria e da come i slicer trattano le pareti sottili. La prova con l'acqua
  resta necessaria.
- **Non ho confrontato il filetto con la norma GPI** quota per quota: il
  cordolo è una semplificazione dichiarata, e lo spool di prova è il modo giusto
  di verificarne l'accoppiamento con la pompa che hai in mano.
- **Compatibilità chimica**: le indicazioni sui materiali valgono per saponi e
  detersivi comuni. Per solventi, alcol, oli essenziali o profumi va verificata
  caso per caso — gli oli essenziali attaccano diversi polimeri.
