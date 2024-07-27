variable "docker_user" {
  type = string
}

variable "docker_password" {
  type = string
}

variable "dockerhub_repository" {
  type = string
}

variable "image_tag" {
  type = string
}

variable "ontap_api_key" {
  type = string
}

variable "telegram_bot_token" {
  type = string
}

variable "openai_api_key" {
  type = string
}

variable "hyperdx_api_key" {
  type = string
}

job "ontap-bot" {
  type        = "service"
  datacenters = ["*"]

  namespace = "ontap"

  group "ontap-bot" {
    task "ontap-bot" {
      driver = "docker"

      config {
        image = "${var.dockerhub_repository}:${var.image_tag}"

        auth {
          username = var.docker_user
          password = var.docker_password
        }
      }

      env {
        ONTAP_API_KEY        = var.ontap_api_key
        TELEGRAM_BOT_TOKEN   = var.telegram_bot_token
        OPENAI_API_KEY       = var.openai_api_key
        HYPERDX_API_KEY      = var.hyperdx_api_key
        PERSISTENT_DATA_PATH = "/data"
      }

      resources {
        memory = 512
      }

      volume_mount {
        volume      = "ontap-bot"
        destination = "/data"
      }
    }

    restart {
      attempts = 3
      delay    = "15s"
      mode     = "delay"
      interval = "1m"
    }

    update {
      canary           = 1
      max_parallel     = 2
      auto_promote     = true
      min_healthy_time = "30s"
    }

    volume "ontap-bot" {
      type      = "host"
      read_only = false
      source    = "ontap-bot"
    }
  }
}
