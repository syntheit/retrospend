package adapters

import (
	"retrospend-sidecar/importer/models"
	"io"
)

type BankAdapter interface {
	Parse(file io.Reader) ([]models.NormalizedTransaction, error)
}
