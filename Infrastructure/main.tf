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
  region  = "us-central1"
  zone    = "us-central1-c"
}

resource "google_compute_network" "vpc_network" {
  name = "main-network"
}
