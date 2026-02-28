package adapters

import (
	"importer/internal/models"
	"io"
)

type BankAdapter interface {
	Parse(file io.Reader) ([]models.NormalizedTransaction, error)
}
