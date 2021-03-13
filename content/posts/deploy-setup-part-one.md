---
title: "How I Deploy Projects to My Hobby Server (Part 1)"
date: 2021-03-12T16:45:40-07:00
tags: [tech, deploy]
---

I have a small hobby server that hosts my weekend projects.
I have a few expectations from my hobby server setup:

1. Projects start up with system
2. Projects can be written in different languages
3. Automated SSL certificates (automated initial creation and renewal)
4. Automated deployment (I'm forgetful. I don't want to remember how to push changes to my projects.)
5. Easy to add new projects (routed to by a domain)

I don't want to manage anything fancy like Kubernetes or Nomad. I want something
that I use everyday so I can set it up and perform maintenance on it as required.

My intention with this post is to give you some ideas for setting up a production ready environment.

My current setup includes:

* DigitalOcean droplet from a Ubuntu image
* Docker and Docker Compose
* Traefik (with Let's Encrypt integration)
* GitLab CI/CD Pipelines
* SSH

It was heavily inspired by
[How To Use Traefik for Docker Containers on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-use-traefik-v2-as-a-reverse-proxy-for-docker-containers-on-ubuntu-20-04).

## High Level Workflow

At a high level, here's my weekend workflow with this setup:

1. Add a new feature to my project
2. Push the changes to my project on GitLab
3. GitLab pipeline builds my project's docker image
2. SSH into my server and run `docker-compose up -d` for the related project
4. Docker compose on server pulls down newly created docker image and updates the docker container

There's a lot of moving pieces here. It could be made simpler, but
I put this all together about two years ago and it's been working for me ever since.
I'm happy with the results and what it has done for me thus far.

## Prerequisites

For this to work, domains and/or subdomains have to be pointing to the DigitalOcean droplet.
I setup a wildcard subdomain to point to the droplet that way new services can be added
rather easily.

My DNS records look like this for reference:

```
Name  Type  Data
*     A     206.189.208.104
```

## Details of Setup

### DigitalOcean Droplet

For computing needs I use DigitalOcean. They have a service called
[Droplets](https://www.digitalocean.com/products/droplets/).
Droplets are a virtual machine that can be accessed anywhere on the internet.
It starts out at $5 per month. (A modest amount for how much you get in my opinion.)

To get started, follow these tutorials: [How To Set Up an Ubuntu Server on a DigitalOcean Droplet](https://www.digitalocean.com/community/tutorials/how-to-set-up-an-ubuntu-20-04-server-on-a-digitalocean-droplet) and [Initial Server Setup with Ubuntu](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-18-04).

### Docker and Docker Compose

I use docker at work and for my weekend projects. It's a tool I'm familiar with.
It's useful for local development and appropriate for production workloads. I
recommended that software engineers become familiar with it because of how
powerful it is.

Docker compose is a useful tool on top of docker. If a service requires third party
dependencies to run (such as a database), one can use docker compose to spin them all up
together. Docker compose enables higher workflows for docker.

To install docker and docker compose on a DigitalOcean droplet, follow this tutorial:
[How To Install and Use Docker on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-20-04).

All of my projects include a `Dockerfile` in the root of the project. This file is needed
to build a docker image for each project that can be ran on the server. Dockerfiles can be
tricky -- but there's plenty of tutorials and resources to get started.

### Traefik

Traefik is a reverse proxy. It does several things that I love (over something like nginx):

* Automatically obtains and renews SSL certificates for all my services
* Automatically discovers new services running as docker containers to route traffic to

Since I'm using docker to run all my services, I also run Traefik as a docker container.
There's a little bit of special setup needed to run Traefik in docker.
I followed this tutorial by Traefik to get my initial setup working:
[Docker-compose with let's encrypt: HTTP Challenge](https://doc.traefik.io/traefik/user-guides/docker-compose/acme-http/).

For my particular setup, I put everything under `/opt/traefik` on my server.

For docker containers to talk to each other, they must belong to the same network.
I created a docker network `web` so that Traefik can route traffic from itself
to other running docker containers: `docker network create web`.

My specific setup uses the following files to setup and configure Traefik:

#### `/opt/traefik/docker-compose.yml`

```yml
version: '3'

services:
  traefik:
    image: traefik:v1.7
    restart: always
    ports:
      - 80:80
      - 443:443
    networks:
      - web
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/traefik/traefik.toml:/traefik.toml
      - /opt/traefik/acme.json:/acme.json
    container_name: traefik

networks:
  web:
    external: true
```

The `/var/run/docker.sock` docker volume is what allows docker to discover running containers
to route traffic to. We'll see how to add a service to route traffic to later on in this post.

The `traefik.toml` docker volume is Traefik's config file to get everything working.

The `acme.json` file is where the SSL certificates are stored. It's private since it
contains the private keys for my web services.

#### `/opt/traefik/traefik.toml`

```toml
logLevel = "INFO"

defaultEntryPoints = ["http", "https"]

[entryPoints]
  [entryPoints.http]
  address = ":80"
    [entryPoints.http.redirect]
    entryPoint = "https"

  [entryPoints.https]
  address = ":443"
    [entryPoints.https.tls]

[docker]
endpoint = "unix:///var/run/docker.sock"
domain = "luckywatcher.dev"
watch = true
exposedByDefault = false
network = "web"

[acme]
email = "brian@luckywatcher.dev"
storage = "acme.json"
entryPoint = "https"
onHostRule = true

  [acme.httpChallenge]
  entryPoint = "http"
```

This is the bare minimum configuration I needed to get Traefik working as I wanted.
It redirects to SSL for those hitting any HTTP version of my services.

### GitLab CI/CD Pipelines

I use GitLab for hosting my code, building new docker images, and hosting docker images for my projects.

My projects share a very similar `.gitlab-ci.yml` file to one another.
I followed this [GitLab tutorial](https://docs.gitlab.com/ee/ci/docker/using_docker_build.html)
originally -- but there's a lot of information there. It boiled down to this for me:

#### Template `.gitlab-ci.yml`

```yml
stages:
  - build

build:
  image: docker:19.03.1
  stage: build
  services:
    - docker:19.03.1-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker pull $CI_REGISTRY_IMAGE:latest || true
    - docker build --cache-from $CI_REGISTRY_IMAGE:latest --tag $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA --tag $CI_REGISTRY_IMAGE:latest .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
    - docker push $CI_REGISTRY_IMAGE:latest
  only:
    refs:
      - master
```

On every push to master, this runs a pipeline with one job named `build`. It performs the following steps:

1. Logins to the docker repository that GitLab provides with each project
2. Pulls down the latest docker image for the project (or fails gracefully
3. Builds a new docker image (using the latest one as a cache to speedup builds)
    - It'll tag the created docker image with the sha of the commit and `latest`
4. Push up the newly created docker image to GitLab

After the docker image is built and pushed to GitLab, it can be pulled by my server and ran in docker.

### SSH

Now that I have everything setup, it's time to pull it all together.
To pull down the newly created docker image and update the services, I use SSH.

On my server I have a directory for each service running.
In each of those directories, there's a `docker-compose.yml`.

As an example, I've included the file contents of my [mormonsearch](https://mormonsearch.luckywatcher.dev)
service ([source code on GitLab](https://gitlab.com/brian_petersen/mormonsearch)):

#### `/home/brian/mormonsearch/docker-compose.yml`

```yml
version: '3'

services:
  app:
    image: registry.gitlab.com/brian_petersen/mormonsearch:latest
    restart: always
    networks:
      - web
    labels:
      - traefik.backend=mormonsearch
      - traefik.docker.network=web
      - traefik.frontend.rule=Host:mormonsearch.luckywatcher.dev
      - traefik.enable=true
      - traefik.port=80
    container_name: mormonsearch

networks:
  web:
    external: true
```

A few things to note:

* The image is pointing to the one built and hosted by GitLab.
* `restart: always` ensures the container starts up when the system does
* The container is attached to the `web` network so Traefik can find it and route traffic to it
* The labels are for Traefik
    * `traefik.frontend.rule=Host:mormonsearch.luckywatcher.dev`
      means traffic to `mormonsearch.luckywatcher.dev` is routed to this container
    * `traefik.port=4000` means traffic is routed to port 4000 on the container

So, piecing it all together it works like so:

1. `ssh ssh.luckywatcher.dev`
2. `cd /home/brian/mormonsearch`
3. `docker-compose up -d`

## Adding New Services

There's a lot of initial setup here, but it shines when adding a new service.
To add a new service I follow these steps:

1. Setup GitLab repo
2. Setup Dockerfile
3. Copy `.gitlab-ci.yml` to enable the CI/CD pipeline to build and publish docker images
4. Write new `docker-compose.yml` file on server (in new directory named for service)
5. Run `docker-compose up -d` on server

The server then does the following:

1. Automatically picks up the new container
2. Obtains an SSL certificate for the service
3. Routes traffic to the service (assuming the domain is pointing to my server already)

## Potential Improvements

* Automate deployments
    * Eliminates the the SSH and `docker-compose up -d` steps in the current flow
    * Upcoming part 2 of this post
* Easy way to rollback bad deploys

## Summary

I'm quite happy with my current deploy setup. I setup it up two years ago and haven't
had any headaches with it. It is quite heavy compared to something like Heroku -- but
I wanted to string something together for learning sake.

## Additional Examples (Database, Data Persistence, etc.)

Some services require a database for persistence, file storage for uploads, and runtime secrets.
The following `docker-compose.yml` file shows how you can accomplish these things with this setup.

```yml
version: '3'

services:
  db:
    image: postgres:11.5
    restart: always
    volumes:
      - ./db_data:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ...
      POSTGRES_DB: toastme

  app:
    image: registry.gitlab.com/brian_petersen/toastme:latest
    restart: always
    volumes:
      - ./uploads:/app/lib/toastme-0.1.0/priv/static/uploads
    networks:
      - default
      - web
    labels:
      - traefik.backend=slam
      - traefik.docker.network=web
      - traefik.frontend.rule=Host:slam.luckywatcher.dev
      - traefik.enable=true
      - traefik.port=4000
    depends_on:
      - db
    environment:
      DATABASE_URL: ecto://postgres:...@db/toastme
      SECRET_KEY_BASE: ...
    container_name: toastme

networks:
  web:
    external: true
```

The container `app` is attached to networks `default` and `web` so that it
can communicate to the database container and be picked up by `traefik`.

Secrets are inlined into the `docker-compose.yml` file since the file is not
public. Volumes mapped to local directories are used for data persistence.
