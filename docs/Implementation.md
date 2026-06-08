**Implementeringsmuligheder**
Da der er valgfrihed til drift i OS2ai, det vil sige det er muligt at drifte selv eller hos en valgfri driftsleverandør, er der behov for forskellige implementeringsmuligheder. 
Den enkelte myndighed beslutter selv, hvilken implementeringsform der er mest fordrende.

Implementeringsmuligheder for adgangskomponenten:
-	Egen opsætning og ejerskab
-	Managed opsætning gennem driftsleverandør

**Implementeringsmulighed 1: egen opsætning og ejerskab** 

Med en self-managed instans af Adgangskomponenten følger myndigheden en vejledning, der instruerer udførligt i opsætningen af adgangskomponenten. Det vurderes at opsætningen tager cirka 30 minutter. 
Som et led i opsætningen af adgangskomponenten skal myndigheden håndtere certifikater til løsningen. 

Fordelen ved egen opsætning af komponenten er, at myndigheden er mindre fastlåst i sit forhold til en leverandør. Drift af en generativ AI er en kompliceret opgave, hvor hardware udvikler sig hurtigt, muligheder og priser ændrer sig konstant. Ved at eje certifikaterne selv sikrer I en højere agilitet og leverandøruafhængighed, når I ønsker at skifte driftsleverandør for at få adgang til f.eks. en bedre og billigere sprogmodel. Konkret betyder det, at I ikke skal ændre opsætning i adgangskomponenten, selvom I skifter leverandør, leverandøren ophører el.lign. Ved skift af driftsleverandør kan I flytte Adgangskomponenten og dens forbindelser til systemer til en anden infrastrukturplatform ved blot at migrere indholdet af Adgangskomponentens database.
Samtidig risikerer man ikke at en leverandør blokerer for integration af systemer igennem Adgangskomponenten, hvis de ikke er interesserede i at vedligeholde dem. Når man selv manager Adgangskomponenten kan man i højere grad selv tage styring over den.

I forbindelse med IT-sikkerhed og adgangsstyring er certifikater en form for "digitalt pas". De bruges til at bekræfte identiteten på en bruger, en maskine eller en server, så man er sikker på, hvem der forsøger at få adgang. I vejledningen findes også vejledning for håndtering af certifikater. Certifikaterne skal fornyes hvert 3. år med en arbejdstid på cirka 15 minutter.
 

**Implementeringsmulighed 2: managed service** 

Alternativt kan man benytte en managed Adgangskomponent, som styres af en leverandør. 

En managed Adgangskomponent minder om andre leverandørsystemer, som man forbinder til via FKA: leverandøren opsætter IT-systemet i FKA og vedligeholder certifikater. 
Myndigheden skal blot opsætte deres forbindelse til IT-systemet.

Det er fuldt ud muligt at outsource opgaven til driftsleverandøren. Det kan betyde en tidsbesparelse hos myndigheden, så længe man er opmærksom på ulemperne.

Den største ulempe ved denne tilgang er at man nu er afhængig af leverandørens tid (og dermed har eventuelle tilhørende udgifter) såfremt Adgangskomponentens opsætning skal ændres. 
Derudover skal man være opmærksom på at man ikke ejer opsætningen selv. Det vil sige, at hvis man ønsker at skifte leverandør skal man igennem opsætning af forbindelser til Adgangskomponenten igen, både igennem FKA og til alle de systemer der er forbundet til Adgangskomponenten, og derigennem giver adgang til login gennem FKA. Dette medfører naturligvis en udgift forbundet med at skift og giver mindre fleksibilitet i infrastrukturen.
