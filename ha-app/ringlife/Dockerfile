# Il jar si costruisce fuori (PC o CI): il server di casa non compila Java. Vedi scripts/package-ha-app.sh.
# I tag delle immagini vanno verificati alla prima build.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:trixie

# JRE 25, la stessa versione di Java del backend (backend/pom.xml).
FROM eclipse-temurin:25-jre AS jre

FROM ${BUILD_FROM}
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
RUN java -version

WORKDIR /opt/ringlife
COPY ringlife-backend.jar /opt/ringlife/ringlife-backend.jar
COPY THIRD-PARTY-LICENSES.txt /opt/ringlife/THIRD-PARTY-LICENSES.txt
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
