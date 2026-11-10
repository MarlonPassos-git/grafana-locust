from locust import HttpUser, between, task

class Visitor(HttpUser):
    wait_time = between(0.5, 1)

    @task
    def index(self):
        self.client.get("/")
