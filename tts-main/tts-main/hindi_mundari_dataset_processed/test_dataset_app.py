import unittest

from dataset_app import load_dataset_summary


class DatasetAppTests(unittest.TestCase):
    def test_load_dataset_summary(self):
        summary = load_dataset_summary()

        self.assertIn("train", summary)
        self.assertIn("validation", summary)
        self.assertIn("test", summary)
        self.assertGreater(summary["train"]["rows"], 0)
        self.assertGreater(summary["validation"]["rows"], 0)
        self.assertGreater(summary["test"]["rows"], 0)


if __name__ == "__main__":
    unittest.main()
