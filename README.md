# Hisense AR Show

App web AR pronta per GitHub Pages.

## Upload su GitHub

Carica nella root del repository questi file e cartelle:

- `index.html`
- `styles.css`
- `manifest.webmanifest`
- `.nojekyll`
- `assets/`
- `src/`
- `vendor/`

Poi abilita GitHub Pages da **Settings → Pages → Deploy from a branch**, branch `main`, folder `/root`.

## URL previsto

Se il repository resta `360maker/test`, l'app sara' raggiungibile da:

`https://360maker.github.io/test/`

## Nota sui cellulari Android

L'app non aspetta il rilevamento del piano. Su Android con WebXR avvia una sessione AR in spazio `local`, poi l'utente allinea la sagoma della coppa e blocca lo show. Se WebXR/ARCore non e' disponibile o non e' affidabile, usa automaticamente la modalita' compatibile camera + WebGL.

## Nota sui dispositivi iOS

Su iPhone/iPad l'app usa il file `assets/Scena_Corretta.usdz` con AR Quick Look, mentre Android continua a usare il GLB `assets/Scena_Corretta_512.glb`.
