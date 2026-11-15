terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "6.8.0"
    }
  }

  backend "gcs" {
    bucket = "infrastructure-ai-pm"
    prefix = "terraform/state"
  }

}

provider "google" {
  project = "liquid-streamer-284510"
  region  = var.region
  zone    = var.zone
}

resource "google_compute_network" "vpc_network" {
  name = "main-network"
}

resource "google_compute_subnetwork" "main" {
  name          = "main-subnet-${var.region}"
  network       = google_compute_network.vpc_network.id
  region        = var.region
  ip_cidr_range = "10.10.0.0/24"
}
