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
| Parete del corpo | **tiene**, è esattamente quella impostata | 2,0–8,0 mm dal fondo fino al 70 % dell'altezza |
| Fascia di spalla | **tiene**, dopo la correzione della geometria | 2,00–3,20 mm, esattamente la parete impostata (era 0,90 mm) |
| Collo filettato | **tiene** | parete 3,0 mm costanti, battuta di tenuta piana larga 3,0 mm |
| Inclinazione massima | entro i 45° sui preset | 36–42°, lo studio segnala in rosso oltre 45° |

**In una riga:** i pezzi sono a tenuta su tutta la corsa dei cursori. La parete
misurata è ovunque quella impostata, cioè almeno cinque passate di estrusione.

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
riga per riga. Non stima nulla: legge i vertici.

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

Il pavimento della cavità sta a **3,0–3,9 mm** dal piano (la prima riga della
mesh oltre i 3 mm; cresce con l'altezza del pezzo). L'incisione arriva al
massimo a **1,2 mm**, quindi sotto il liquido restano sempre **almeno 1,8 mm**
di materiale pieno — nove strati. Lo studio lo mostra come «≥ x mm pieni» ed è
un vincolo di costruzione, non una raccomandazione: i cursori non permettono di
violarlo.

Dal fondo pieno nella ricetta (`bottom_solid_min_thickness = 4`) quei
millimetri sono anche **stampati** pieni, non solo geometricamente: prima ne
venivano solidi 2,0 e in mezzo restava reticolo al 6 %, col vero sbarramento
affidato a 1 mm di strati pieni stesi sopra il vuoto.

L'incisione, poi, non è una cava a fondo piatto ma una **conca a sezione
parabolica larga 1,5 mm**: ogni strato chiude un po' più del precedente e
l'ultimo attraversa sei decimi di millimetro. Nessun ponte, nessuna superficie
sospesa. È il tipo di incisione che si stampa bene.

### La parete del corpo — esattamente quella impostata

Dal fondo fino a circa il 70 % dell'altezza la parete misura **esattamente** il
valore del cursore: 2,40 mm richiesti, 2,40 mm misurati. Il motore tiene
costante lo spessore anche dove le costole entrano ed escono.

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

Il segnale personale (GPX o voce) non peggiora la situazione: alla massima
intensità toglie 0,06 mm al minimo, il limitatore assorbe il resto.

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
| **Larghezza di estrusione** *(già nel 3MF)* | **0,40 mm** | Le pareti che lo studio propone (2,0 · 2,4 · 2,8 · 3,2) sono tutte multipli esatti di 0,40: i perimetri le riempiono senza avanzi. A 0,45 — il default di PrusaSlicer per un ugello da 0,4 — una parete da 2,4 mm lascia 0,15 mm di fessura che corre per tutta l'altezza del pezzo. |
| **Perimetri** *(già nel 3MF)* | **4 o più, li scrive lo studio** | Quattro per lato coprono 3,2 mm: bastavano finché la parete massima era 3,2. Ora la parete arriva a 8 mm e il numero lo calcola l'export (`recipeFor`), perché il guscio resti fatto **solo** di perimetri. Vedi «La parete spessa» qui sotto: è il punto in cui una parete grossa può diventare più debole di una sottile. Sotto i 4 si perde comunque il perimetro centrale di sicurezza. |
| **Ventola** | **max 30 %, spenta sui primi 5 strati** | Sul PETG è la prima causa di perdite: raffredda la passata prima che si saldi a quella sotto e il pezzo trasuda lungo le righe di strato. |
| **Temperatura ugello** | **240 °C** (245 il primo strato) | Più caldo salda meglio. Se compaiono fili, si tolgono dopo; una delaminazione non si toglie. |
| **Fondo pieno** *(già nel 3MF)* | `bottom_solid_min_thickness = 4` | Sostituisce sia i «6 / 6 strati pieni» sia l'aumento del riempimento: il pavimento viene pieno per tutti i suoi 3–4 mm, quindi sotto il liquido non resta reticolo. Costa +9–14 % di materiale. Di conseguenza il pezzo non ha più alcuna zona a riempimento rado e il valore del gyroid è ininfluente. |
| **Cucitura (Z-seam)** *(nel 3MF: `random`)* | **a becco di flauto** (*scarf joint*) dove c'è; altrimenti vedi la nota qui sotto | La cucitura è la fila di partenze e arresti dei perimetri: è lì che si formano i micro-fori. Sul *scarf joint* non c'è discussione — rampa l'estrusione e il difetto non si forma proprio: se il tuo slicer ce l'ha, usalo. Su cosa fare quando non c'è, questo documento e la ricetta incorporata **non concordano**: vedi «Cucitura: una scelta aperta». |
| **Strato** | 0,20 mm, primo 0,24 mm | Più fine non aiuta la tenuta e raddoppia il tempo. |
| **Compensazione zampa d'elefante** | 0,15 mm | Senza, la base svasa e il codice inciso si chiude. |
| **Stiratura** *(ironing)* | attiva sulle superfici superiori | Le uniche superfici superiori sono la battuta del collo e il pavimento della cavità: lisciarle costa pochi secondi e la guarnizione della pompa appoggia su una superficie piana invece che su righe. |
| **Supporti** | **nessuno** | Il motore vincola tutte le pareti a 44°. Se lo studio segnala più di 45°, cambia il design: i supporti dentro la cavità non si tolgono. |
| **Brim** | 0, ma **8 mm sui pezzi alti e stretti** | Un tornado da 235 mm su una base da Ø60 si stacca. |
| **Calibrazione del flusso** | obbligatoria | Un flusso al 95 % lascia fra le passate fessure che nessuna impostazione compensa. Vale la mezz'ora del test a parete singola. |

La ricetta incorporata nei file **3MF** esportati dallo studio (`Slic3r_PE.config`
e `project_settings.config`) porta già strato, perimetri, strati pieni,
riempimento e assenza di supporti. Larghezza di estrusione, generatore di
perimetri, temperature e ventola dipendono dalla stampante e dal filo: vanno
impostate nel profilo dello slicer.

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
