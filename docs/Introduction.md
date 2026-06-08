# Introduktion til Adgangskomponenten

Denne beskrivelse giver et overblik over Adgangskomponenten i OS2ai. Adgangskomponenten er en strategisk valgt, løstkoblet komponent, der sikrer modularitet i arkitekturen. 
Dette design gør det muligt løbende at opdatere den tekniske stack i OS2ai uden at skulle genopbygge forbindelsen til eksterne systemer.

## Hvad er Adgangskomponenten?

Adgangskomponenten er en løstkoblet adgangskomponent, der også fungerer som bindeleddet mellem OS2ai og Fælleskommunal Adgangsstyring (FKA). Dens primære opgaver og egenskaber inkluderer:

* **Løskobling** Den sikrer løskobling af adgangsstyringen, så adgangsstyringen ikke skal genetableres, såfremt væsentlige komponenter i OS2ai ændres
* **Oversætter:** Den fungerer som en oversætter mellem den ældre standard IOISaml3 (som FKA benytter) og moderne formater som OIDC (som OS2ai benytter).
* **Målgruppe:** Den er særligt relevant for myndigheder, der ikke i forvejen udstiller OIDC tokens.
* **Fleksibilitet:** Komponenten er bygget til at kunne forbinde til alle systemer, der understøtter OIDC-protokollen.
* **Placering:** Det anbefales som udgangspunkt, at man kører en instans af Adgangskomponenten i samme cluster som ens OS2ai-instans.

## Hvordan fungerer adgang i hverdagen?

Adgangsstyringen er baseret på konceptet om **jobfunktionsroller**, som administreres i FKA. I praksis fungerer det således:

* **Tildeling af roller:** En medarbejder får tildelt en jobfunktionsrolle af myndighedens egen identitetsudbyder (IdP).
* **Rettigheder i systemet:** IT-systemet (f.eks. OS2ai) definerer "brugersystemroller", som beskriver de konkrete rettigheder eller funktioner, en bruger kan have.
* **Koblingen:** Jobfunktionsrollen i FKA er indstillet til at pege på en liste af disse brugersystemroller.
* **Login-processen:** Når brugeren logger på, bestemmer jobfunktionsrollen automatisk, hvilke adgange og rettigheder brugeren får i systemet.
* **Lokal kontrol:** Denne struktur betyder, at den enkelte kommune selv har fuldt ejerskab over adgangsstyringen. Man kan f.eks. nemt tildele adgang til en hel afdeling eller give IT-administratorer specifikke rettigheder til at styre systemets opsætning.
